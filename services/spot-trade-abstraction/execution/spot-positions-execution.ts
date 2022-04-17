import { strict as assert } from "assert"

import Sentry from "../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../../interfaces/logger"
import { MarketIdentifier_V3 } from "../../../events/shared/market-identifier"
import {
  OrderContext_V1,
  SpotExecutionEngine,
} from "../../../classes/spot/exchanges/interfaces/spot-execution-engine"
import { SpotPositionsPersistance } from "../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SendMessageFunc } from "../../../lib/telegram-v2"
import { PositionSizer } from "../fixed-position-sizer"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"
import {
  AuthorisedEdgeType,
  check_edge,
  SpotPositionIdentifier_V3,
} from "../../../classes/spot/abstractions/position-identifier"
import { OrderId } from "../../../classes/spot/persistence/interface/order-context-persistence"
import { Edge60SpotPositionsExecution } from "./edge60-executor"
import { Edge61SpotPositionsExecution } from "./edge61-executor"
import { CurrentPriceGetter } from "../../../interfaces/exchange/generic/price-getter"
import { TradeAbstractionOpenSpotLongCommand, TradeAbstractionOpenSpotLongResult } from "../interfaces/open_spot"
import {
  TradeAbstractionCloseSpotLongResult,
  TradeAbstractionCloseSpotLongResult_NOT_FOUND,
  TradeAbstractionCloseSpotLongResult_SUCCESS,
} from "../interfaces/close_spot"

/**
 * If this does the execution of spot position entry/exit
 *
 * It is a low level class intended to be used by the TAS
 *
 * If you want to open positions in a safe way protected by the trading rules, use the tas-client instead
 *
 * Note this is instantiated with a particular exchange, the exchange identifier is
 * fixed at instantiation
 */

export interface SpotPositionExecutionCloseResult {
  base_asset: string
  quote_asset: string
  edge: string
}

export class SpotPositionsExecution {
  logger: Logger
  ee: SpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistance
  price_getter: CurrentPriceGetter

  /* executors - really need to refactor this */
  edge60_executor: Edge60SpotPositionsExecution
  edge61_executor: Edge61SpotPositionsExecution

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    position_sizer,
    price_getter,
  }: {
    logger: Logger
    ee: SpotExecutionEngine
    positions_persistance: SpotPositionsPersistance
    send_message: SendMessageFunc
    position_sizer: PositionSizer
    price_getter: CurrentPriceGetter
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.position_sizer = position_sizer
    this.price_getter = price_getter
    this.edge60_executor = new Edge60SpotPositionsExecution({
      logger,
      ee,
      positions_persistance,
      send_message,
      position_sizer,
      price_getter,
    })
    this.edge61_executor = new Edge61SpotPositionsExecution({
      logger,
      ee,
      positions_persistance,
      send_message,
      position_sizer,
      price_getter,
    })
  }

  in_position({ base_asset, edge }: { base_asset: string; edge: AuthorisedEdgeType }) {
    return this.positions_persistance.in_position({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
    })
  }

  exisiting_position_size({ base_asset, edge }: { base_asset: string; edge: AuthorisedEdgeType }) {
    return this.positions_persistance.position_size({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
    })
  }

  // Used when constructing orders
  private get_market_identifier_for(args: { quote_asset: string; base_asset: string }): MarketIdentifier_V3 {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V3 {
    return this.ee.get_exchange_identifier()
  }

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */
  // {
  //     executed_quote_quantity: string
  //     stop_order_id: string | number | undefined
  //     executed_price: BigNumber
  //     stop_price: BigNumber
  //   }
  async open_position(args: TradeAbstractionOpenSpotLongCommand): Promise<TradeAbstractionOpenSpotLongResult> {
    try {
      args.edge = check_edge(args.edge)
      let { edge, quote_asset } = args
      if (!quote_asset) throw new Error(`quote_asset not defined`)

      /**
       * Check if already in a position
       */
      if (await this.in_position(args)) {
        let msg = `Already in position on ${args.edge}:${args.base_asset}`
        this.send_message(msg, { edge })
        throw new Error(msg)
      }

      switch (args.edge) {
        case "edge60":
          return this.edge60_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(8),
            edge_percentage_buy_limit: new BigNumber(5), // arbitrary
          })
        case "edge61":
          return this.edge61_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(5),
            edge_percentage_stop_limit: new BigNumber(15),
            edge_percentage_take_profit: new BigNumber(5),
            edge_percentage_buy_limit: new BigNumber(0.5),
          })
        default:
          let msg = `Opening positions on edge ${args.edge} not permitted at the moment`
          this.send_message(msg, { edge })
          throw new Error(msg)
      }
    } catch (err: any) {
      this.logger.error({ err })
      Sentry.captureException(err)
      let result: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset: args.base_asset,
        quote_asset: args.quote_asset,
        edge: args.edge,
        status: "INTERNAL_SERVER_ERROR",
        msg: err.message,
        err,
        execution_timestamp_ms: Date.now().toString(),
      }
      return result
    }
  }

  async close_position({
    quote_asset,
    base_asset,
    direction,
    edge,
  }: {
    quote_asset: string
    base_asset: string
    direction: string
    edge: AuthorisedEdgeType
  }): Promise<TradeAbstractionCloseSpotLongResult> {
    assert.equal(direction, "long") // spot positions are always long
    let prefix: string = `Closing ${edge}:${base_asset} spot position:`

    if (!(await this.in_position({ base_asset, edge }))) {
      let obj: TradeAbstractionCloseSpotLongResult_NOT_FOUND = {
        object_type: "TradeAbstractionCloseSpotLongResult",
        version: 1,
        status: "NOT_FOUND",
        http_status: 404,
        msg: `Spot Close: there is no known long spot position on ${base_asset}, skipping close request`,
        base_asset,
        edge,
      }
      this.logger.warn({ edge, base_asset }, obj)
      return obj
    }

    /**
     * 1. Get stop order id and cancel it
     * 2. market sell position
     */

    let spot_position_identifier: SpotPositionIdentifier_V3 = {
      exchange_identifier: this.get_exchange_identifier(),
      base_asset,
      edge,
    }

    let market_identifier = this.ee.get_market_identifier_for({ quote_asset, base_asset })
    let symbol = market_identifier.symbol

    try {
      /** Cancel stop order if there is one */
      let stop_order_id: OrderId | undefined = await this.positions_persistance.get_stop_order(
        spot_position_identifier
      )

      if (stop_order_id) {
        this.send_message(`${prefix} cancelling stop order ${stop_order_id} on ${symbol}`, { edge })
        await this.ee.cancel_order({
          order_id: stop_order_id,
          symbol,
        })
      } else {
        let msg = `${prefix} No stop order found`
        this.logger.info(msg)
        this.send_message(msg, { edge })
      }
    } catch (err) {
      let msg = `Failed to cancel stop order on ${symbol} - was it cancelled manually?`
      this.logger.warn(msg)
      this.logger.warn({ err })
      Sentry.captureException(err)
      this.send_message(msg, { edge })
    }

    try {
      /** Cancel oco order if there is one */
      let oco_order_id: OrderId | null = await this.positions_persistance.get_oco_order(spot_position_identifier)

      if (oco_order_id) {
        this.send_message(`${prefix} cancelling oco order ${oco_order_id} on ${symbol}`, { edge })
        await this.ee.cancel_oco_order({
          order_id: oco_order_id,
          symbol,
        })
      } else {
        let msg = `${prefix} No oco order found`
        this.logger.info(msg)
        this.send_message(msg, { edge })
      }
    } catch (err) {
      let msg = `Failed to cancel oco order on ${symbol} - was it cancelled manually?`
      this.logger.warn(msg)
      this.logger.warn({ err })
      Sentry.captureException(err)
      this.send_message(msg, { edge })
    }

    // Continue even if the attempt to cancel the stop/oco orders fails

    try {
      /** Exit the position */
      let base_amount = await this.exisiting_position_size({ base_asset, edge })
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
      await this.ee.market_sell({ order_context, market_identifier, base_amount }) // throws if it fails
      // let executed_amount = // .. actually we might not have this info immediately

      let obj: TradeAbstractionCloseSpotLongResult_SUCCESS = {
        object_type: "TradeAbstractionCloseSpotLongResult",
        version: 1,
        status: "SUCCESS",
        http_status: 200,
        msg: `Spot Close ${edge}:${base_asset}: SUCCESS`,
        base_asset,
        quote_asset,
        edge,
      }
      return obj
    } catch (err) {
      let msg = `Failed to exit position on ${symbol}`
      this.logger.warn(msg)
      this.logger.warn({ err })
      Sentry.captureException(err)
      this.send_message(msg, { edge })
      throw err
    }
  }
}
