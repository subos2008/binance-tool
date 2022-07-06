import { strict as assert } from "assert"
import { randomUUID } from "crypto"

import Sentry from "../../../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../../../interfaces/logger"
import { SendMessageFunc } from "../../../../../lib/telegram-v2"
import { PositionSizer } from "../../../../../edges/position-sizer/fixed-position-sizer"
import {
  TradeAbstractionOpenShortCommand as IncommingTradeAbstractionOpenShortCommand,
  TradeAbstractionOpenShortResult,
} from "../interfaces/short"

interface TradeAbstractionOpenShortCommand extends IncommingTradeAbstractionOpenShortCommand {
  quote_asset: string // added by the TAS before it hits the EE
}

import { check_edge } from "../../../../../classes/spot/abstractions/position-identifier"
import {
  BinanceFuturesExecutionEngine,
  LimitSellByQuoteQuantityWithTPandSLCommand,
} from "./execution_engines/binance-futures-execution-engine"

import { CurrentPriceGetter } from "../../../../../interfaces/exchanges/generic/price-getter"
import { map_tas_to_ee_cmd_short } from "../../../../../edges/edge62/edge62-tas-to-ee-mapper"
import { OrderContext_V1, OrderContext_V2 } from "../../../../../interfaces/orders/order-context"
import { Tags } from "hot-shots"

export interface FuturesPositionExecutionCloseResult {
  base_asset: string
  quote_asset: string
  edge: string
}

export class FuturesEdgeToExecutorMapper {
  logger: Logger
  ee: BinanceFuturesExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  // positions_persistance: SpotPositionsPersistance
  price_getter: CurrentPriceGetter

  constructor({
    logger,
    ee,
    // positions_persistance,
    send_message,
    position_sizer,
    price_getter,
  }: {
    logger: Logger
    ee: BinanceFuturesExecutionEngine
    // positions_persistance: SpotPositionsPersistance
    send_message: SendMessageFunc
    position_sizer: PositionSizer
    price_getter: CurrentPriceGetter
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    // this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.position_sizer = position_sizer
    this.price_getter = price_getter
  }

  in_position({ base_asset, edge }: { base_asset: string; edge: string }) {
    throw new Error(`futures in_position not implemented`)
    // return this.positions_persistance.in_position({
    //   base_asset,
    //   exchange_identifier: this.ee.get_exchange_identifier(),
    //   edge,
    // })
  }

  exisiting_position_size({ base_asset, edge }: { base_asset: string; edge: string }) {
    throw new Error(`futures exisiting_position_size not implemented`)
    // return this.positions_persistance.position_size({
    //   base_asset,
    //   exchange_identifier: this.ee.get_exchange_identifier(),
    //   edge,
    // })
  }

  private async trigger_price(tags: Tags, tas_cmd: TradeAbstractionOpenShortCommand): Promise<BigNumber> {
    if (tas_cmd.trigger_price) return new BigNumber(tas_cmd.trigger_price)
    let { quote_asset, base_asset } = tas_cmd
    let market_identifier = await this.ee.get_market_identifier_for({ quote_asset, base_asset })
    let trigger_price = await this.price_getter.get_current_price({ market_symbol: market_identifier.symbol })
    this.logger.warn(
      tags,
      `Using current price as trigger_price (${trigger_price.toFixed()})for ${tas_cmd.edge}:${
        tas_cmd.base_asset
      } entry`
    )
    return trigger_price
  }

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */
  async short(tas_cmd: TradeAbstractionOpenShortCommand): Promise<TradeAbstractionOpenShortResult> {
    try {
      tas_cmd.edge = check_edge(tas_cmd.edge)
      let { edge, quote_asset, base_asset, direction } = tas_cmd
      let tags = { edge, quote_asset, base_asset, direction }
      if (!quote_asset) throw new Error(`quote_asset not defined`)

      this.logger.error(`FuturesEdgeToExecutorMapper:short() not checking if already in position`)
      /**
       * Check if already in a position
       */
      // if (await this.in_position(tas_cmd)) {
      //   let msg = `Already in position on ${tas_cmd.edge}:${tas_cmd.base_asset}`
      //   this.send_message(msg, { edge })
      //   throw new Error(msg)
      // }

      switch (tas_cmd.edge) {
        case "edge62": {
          let trade_id = randomUUID()
          let order_context: OrderContext_V2 = { edge, object_type: "OrderContext", version: 1, trade_id }
          let quote_amount = await this.position_sizer.position_size_in_quote_asset({ ...tas_cmd, quote_asset })
          let trigger_price: BigNumber = await this.trigger_price(tags, tas_cmd)
          let cmd: LimitSellByQuoteQuantityWithTPandSLCommand = await map_tas_to_ee_cmd_short({
            tas_cmd,
            order_context,
            ee: this.ee,
            trigger_price,
            quote_amount,
            quote_asset,
          })
          let result: TradeAbstractionOpenShortResult =
            await this.ee.limit_sell_by_quote_quantity_with_market_tp_and_sl(tags, cmd)
          return result
        }
        default:
          let msg = `${edge}${base_asset}: BAD_INPUTS: TAS does not know how to process ${direction} on this edge`
          let err = new Error(msg)
          let result: TradeAbstractionOpenShortResult = {
            object_type: "TradeAbstractionOpenShortResult",
            version: 1,
            base_asset: base_asset as string,
            quote_asset,
            edge: edge as string,
            status: "BAD_INPUTS",
            http_status: 400,
            buy_filled: false,
            msg,
            err,
            execution_timestamp_ms: Date.now(),
            created_stop_order: false,
            created_take_profit_order: false,
          }
          this.logger.error(msg)
          return result
      }
    } catch (err: any) {
      this.logger.error({ err })
      Sentry.captureException(err)
      let result: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        base_asset: tas_cmd.base_asset,
        quote_asset: tas_cmd.quote_asset,
        edge: tas_cmd.edge,
        status: "INTERNAL_SERVER_ERROR", // TODO: this is why we want an object per trade entry - so we have state about what orders are created / filled. If we had that we can call generic close on errors
        http_status: 500,
        msg: err.message,
        err,
        execution_timestamp_ms: Date.now(),
      }
      return result
    }
  }

  // async close_position({
  //   quote_asset,
  //   base_asset,
  //   direction,
  //   edge,
  // }: {
  //   quote_asset: string
  //   base_asset: string
  //   direction: string
  //   edge: AuthorisedEdgeType
  // }): Promise<TradeAbstractionCloseSpotLongResult> {
  //   assert.equal(direction, "long") // spot positions are always long
  //   let prefix: string = `Closing ${edge}:${base_asset} spot position:`

  //   if (!(await this.in_position({ base_asset, edge }))) {
  //     let obj: TradeAbstractionCloseSpotLongResult_NOT_FOUND = {
  //       object_type: "TradeAbstractionCloseSpotLongResult",
  //       version: 1,
  //       status: "NOT_FOUND",
  //       http_status: 404,
  //       msg: `Spot Close: there is no known long spot position on ${base_asset}, skipping close request`,
  //       base_asset,
  //       edge,
  //     }
  //     this.logger.warn({ edge, base_asset }, obj)
  //     return obj
  //   }

  //   /**
  //    * 1. Get stop order id and cancel it
  //    * 2. market sell position
  //    */

  //   let spot_position_identifier: SpotPositionIdentifier_V3 = {
  //     exchange_identifier: this.get_exchange_identifier(),
  //     base_asset,
  //     edge,
  //   }

  //   let market_identifier = this.ee.get_market_identifier_for({ quote_asset, base_asset })
  //   let symbol = market_identifier.symbol

  //   try {
  //     /** Cancel stop order if there is one */
  //     let stop_order_id: OrderId | undefined = await this.positions_persistance.get_stop_order(
  //       spot_position_identifier
  //     )

  //     if (stop_order_id) {
  //       this.send_message(`${prefix} cancelling stop order ${stop_order_id} on ${symbol}`, { edge })
  //       await this.ee.cancel_order({
  //         order_id: stop_order_id,
  //         symbol,
  //       })
  //     } else {
  //       let msg = `${prefix} No stop order found`
  //       this.logger.info(msg)
  //       this.send_message(msg, { edge })
  //     }
  //   } catch (err) {
  //     let msg = `Failed to cancel stop order on ${symbol} - was it cancelled manually?`
  //     this.logger.warn(msg)
  //     this.logger.warn({ err })
  //     Sentry.captureException(err)
  //     this.send_message(msg, { edge })
  //   }

  //   try {
  //     /** Cancel oco order if there is one */
  //     let oco_order_id: OrderId | null = await this.positions_persistance.get_oco_order(spot_position_identifier)

  //     if (oco_order_id) {
  //       this.send_message(`${prefix} cancelling oco order ${oco_order_id} on ${symbol}`, { edge })
  //       await this.ee.cancel_oco_order({
  //         order_id: oco_order_id,
  //         symbol,
  //       })
  //     } else {
  //       let msg = `${prefix} No oco order found`
  //       this.logger.info(msg)
  //       this.send_message(msg, { edge })
  //     }
  //   } catch (err) {
  //     let msg = `Failed to cancel oco order on ${symbol} - was it cancelled manually?`
  //     this.logger.warn(msg)
  //     this.logger.warn({ err })
  //     Sentry.captureException(err)
  //     this.send_message(msg, { edge })
  //   }

  //   // Continue even if the attempt to cancel the stop/oco orders fails

  //   try {
  //     /** Exit the position */
  //     let base_amount = await this.exisiting_position_size({ base_asset, edge })
  //     let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
  //     await this.ee.market_sell({ order_context, market_identifier, base_amount }) // throws if it fails
  //     // let executed_amount = // .. actually we might not have this info immediately

  //     let obj: TradeAbstractionCloseSpotLongResult_SUCCESS = {
  //       object_type: "TradeAbstractionCloseSpotLongResult",
  //       version: 1,
  //       status: "SUCCESS",
  //       http_status: 200,
  //       msg: `Spot Close ${edge}:${base_asset}: SUCCESS`,
  //       base_asset,
  //       quote_asset,
  //       edge,
  //     }
  //     return obj
  //   } catch (err) {
  //     let msg = `Failed to exit position on ${symbol}`
  //     this.logger.warn(msg)
  //     this.logger.warn({ err })
  //     Sentry.captureException(err)
  //     this.send_message(msg, { edge })
  //     throw err
  //   }
  // }
}
