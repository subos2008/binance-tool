import { strict as assert } from "assert"

import Sentry from "../../../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../../../interfaces/logger"
import { MarketIdentifier_V3 } from "../../../../../events/shared/market-identifier"
import { SendMessageFunc } from "../../../../../lib/telegram-v2"
import { PositionSizer } from "../fixed-position-sizer"
import { TradeAbstractionOpenShortCommand, TradeAbstractionOpenShortResult } from "../interfaces/short"
import {
  LimitSellByQuoteQuantityWithTPandSLCommand,
  TradeAbstractionOpenShortCommand,
  TradeAbstractionOpenShortResult,
} from "../interfaces/short"

import { FuturesExecutionEngine } from "./execution_engines/futures-execution-engine"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import { check_edge } from "../../../../../classes/spot/abstractions/position-identifier"
import { FuturesPositionsExecution_OCOExit } from "./oco-exit-executor"
import { BinanceFuturesExecutionEngine } from "./execution_engines/binance-futures-execution-engine"

import { map_tas_to_ee_cmd_short } from "../../../../../edges/edge62/edge62-tas-to-ee-mapper"
/**
 * This class exists to make sure the definition of each edge is internal to the TAS
 *
 * If this does the execution of spot position entry/exit
 *
 * It is a low level class intended to be used by the TAS
 *
 * If you want to open positions in a safe way protected by the trading rules, use the tas-client instead
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */

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
  positions_persistance: SpotPositionsPersistance

  /* executors - really need to refactor this */
  oco_executor: FuturesPositionsExecution_OCOExit
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
    this.oco_executor = new FuturesPositionsExecution_OCOExit({
      logger,
      ee,
      // positions_persistance,
      send_message,
      position_sizer,
      // price_getter,
    })
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
  // {
  //     executed_quote_quantity: string
  //     stop_order_id: string | number | undefined
  //     executed_price: BigNumber
  //     stop_price: BigNumber
  //   }
  async short(args: TradeAbstractionOpenShortCommand): Promise<TradeAbstractionOpenShortResult> {
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
        case "edge62":
          return this.oco_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(7),
            edge_percentage_stop_limit: new BigNumber(15),
            edge_percentage_take_profit: new BigNumber(7),
            edge_percentage_buy_limit: new BigNumber(0.5),
          let trigger_price: BigNumber = await this.trigger_price(tags, tas_cmd)
          let cmd: LimitSellByQuoteQuantityWithTPandSLCommand = await map_tas_to_ee_cmd_short({
            tas_cmd,
            order_context,
            ee: this.ee,
            trigger_price,
            quote_amount,
          })
        default:
          let msg = `Opening positions on edge ${tas_cmd.edge} not permitted at the moment`
          this.send_message(msg, { edge })
          throw new Error(msg)
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
        status: "INTERNAL_SERVER_ERROR",
        msg: err.message,
        err,
        execution_timestamp_ms: Date.now().toString(),
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
