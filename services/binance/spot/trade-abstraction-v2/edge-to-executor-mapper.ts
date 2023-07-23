import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ServiceLogger } from "../../../../interfaces/logger"
import { MarketIdentifier_V5_with_base_asset } from "../../../../events/shared/market-identifier"
import { SpotPositionsPersistence } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { check_edge, SpotPositionIdentifier_V3 } from "../../../../classes/spot/abstractions/position-identifier"
import {
  OrderContextPersistence_V2,
  OrderId,
} from "../../../../classes/persistent_state/interface/order-context-persistence"
import { SpotPositionsExecution_StopLimitExit } from "./execution/stop-limit-exit-executor"
import { SpotPositionsExecution_OCOExit } from "./execution/oco-exit-executor"
import { CurrentPriceGetter } from "../../../../interfaces/exchanges/generic/price-getter"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import {
  TradeAbstractionCloseCommand,
  TradeAbstractionCloseResult,
  TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR,
  TradeAbstractionCloseResult_NOT_FOUND,
  TradeAbstractionCloseResult_SUCCESS,
} from "./interfaces/close"
import { OrderContext_V1, OrderContext_V2 } from "../../../../interfaces/orders/order-context"
import { FixedPositionSizer } from "../../../../edges/position-sizer/fixed-position-sizer"
import { BinanceSpotExecutionEngine } from "./execution/execution_engines/binance-spot-execution-engine"
import { ContextTags, SendMessageFunc, TradeContextTags } from "../../../../interfaces/send-message"
import { PositionSizer } from "../../../../interfaces/position-sizer"
import {
  SpotStopMarketSellCommand,
  TradeContext,
  TradeContext_with_optional_trade_id,
} from "../../../../interfaces/exchanges/spot-execution-engine"
import {
  TradeAbstractionMoveStopCommand,
  TradeAbstractionMoveStopResult,
  TradeAbstractionMoveStopResult_INTERNAL_SERVER_ERROR,
  TradeAbstractionMoveStopResult_NOT_FOUND,
  TradeAbstractionMoveStopResult_SUCCESS,
} from "./interfaces/move_stop"

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

export class SpotEdgeToExecutorMapper {
  logger: ServiceLogger
  ee: BinanceSpotExecutionEngine
  send_message: SendMessageFunc
  position_sizer: PositionSizer
  positions_persistance: SpotPositionsPersistence
  order_context_persistance: OrderContextPersistence_V2
  price_getter: CurrentPriceGetter

  /* executors - really need to refactor this */
  stop_limit_executor: SpotPositionsExecution_StopLimitExit
  oco_executor: SpotPositionsExecution_OCOExit

  constructor({
    logger,
    ee,
    positions_persistance,
    send_message,
    price_getter,
    order_context_persistence,
  }: {
    logger: ServiceLogger
    ee: BinanceSpotExecutionEngine
    positions_persistance: SpotPositionsPersistence
    send_message: SendMessageFunc
    price_getter: CurrentPriceGetter
    order_context_persistence: OrderContextPersistence_V2
  }) {
    assert(logger)
    this.logger = logger
    assert(ee)
    this.ee = ee
    this.positions_persistance = positions_persistance
    this.send_message = send_message
    this.order_context_persistance = order_context_persistence
    let position_sizer = new FixedPositionSizer({ logger })
    this.position_sizer = position_sizer
    this.price_getter = price_getter
    this.stop_limit_executor = new SpotPositionsExecution_StopLimitExit({
      logger,
      ee,
      positions_persistance,
      send_message,
      position_sizer,
      price_getter,
    })
    this.oco_executor = new SpotPositionsExecution_OCOExit({
      logger,
      ee,
      positions_persistance,
      send_message,
      position_sizer,
      price_getter,
    })
  }

  in_position({ base_asset, edge }: { base_asset: string; edge: string }) {
    return this.positions_persistance.in_position({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
    })
  }

  exisiting_position_size({ base_asset, edge }: { base_asset: string; edge: string }) {
    return this.positions_persistance.position_size({
      base_asset,
      exchange_identifier: this.ee.get_exchange_identifier(),
      edge,
    })
  }

  // Used when constructing orders
  private get_market_identifier_for(args: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V5_with_base_asset {
    return this.ee.get_market_identifier_for(args)
  }

  private get_exchange_identifier(): ExchangeIdentifier_V4 {
    return this.ee.get_exchange_identifier()
  }

  /* Open both does [eventually] the order execution/tracking, sizing, and maintains redis */
  // {
  //     executed_quote_quantity: string
  //     stop_order_id: string | number | undefined
  //     executed_price: BigNumber
  //     stop_price: BigNumber
  //   }
  async open_position(args: TradeAbstractionOpenLongCommand): Promise<TradeAbstractionOpenLongResult> {
    let { edge, quote_asset, base_asset, trade_id } = args
    let tags: TradeContextTags = { edge, quote_asset, base_asset, trade_id }
    try {
      args.edge = check_edge(args.edge)
      let { edge, quote_asset } = args
      if (!quote_asset) throw new Error(`quote_asset not defined`)

      /**
       * Check if already in a position
       */
      if (await this.in_position(args)) {
        let msg = `Already in position on ${args.edge}:${args.base_asset}`
        this.send_message(msg, tags)
        this.logger.todo({ level: "warn", ...tags }, `Can throw instead of returning Result object`)
        throw new Error(msg)
      }

      switch (args.edge) {
        case "edge60":
          return await this.stop_limit_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(7),
            edge_percentage_buy_limit: new BigNumber(0.5), // when we had this higher it executed with a 4% slippage
          })
        case "edge70":
          return await this.stop_limit_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(15), // We see significantly better bull performance with this and not much difference in a bear
            edge_percentage_buy_limit: new BigNumber(0.5), // when we had this higher it executed with a 4% slippage
          })
        case "edge61":
          return await this.oco_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(5),
            edge_percentage_stop_limit: new BigNumber(15),
            edge_percentage_take_profit: new BigNumber(5),
            edge_percentage_buy_limit: new BigNumber(0.5),
          })
        case "edge62":
          return await this.oco_executor.open_position({
            ...args,
            quote_asset,
            edge_percentage_stop: new BigNumber(7),
            edge_percentage_stop_limit: new BigNumber(15),
            edge_percentage_take_profit: new BigNumber(7),
            edge_percentage_buy_limit: new BigNumber(0.5),
          })
        default:
          let msg = `Opening positions on edge ${args.edge} not permitted at the moment`
          this.send_message(msg, tags)
          this.logger.todo({ level: "warn", ...tags }, `Can throw instead of returning Result object`)
          throw new Error(msg)
      }
    } catch (err: any) {
      this.logger.exception(tags, err)
      let spot_long_result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        object_class: "result",
        version: 1,
        base_asset: args.base_asset,
        quote_asset: args.quote_asset,
        edge: args.edge,
        trade_id,
        status: "INTERNAL_SERVER_ERROR",
        http_status: 500,
        msg: err.message,
        err,
        execution_timestamp_ms: Date.now(),
      }
      this.logger.result({ ...tags, level: "error" }, spot_long_result, "created")
      return spot_long_result
    }
  }

  async close_position(
    cmd: TradeAbstractionCloseCommand,
    { quote_asset }: { quote_asset: string }
  ): Promise<TradeAbstractionCloseResult> {
    let { edge, base_asset, action } = cmd
    let tags: ContextTags = { edge, base_asset }
    let prefix: string = `Closing ${edge}:${base_asset} spot position:`

    let execution_timestamp_ms = +Date.now()
    let signal_to_execution_slippage_ms = execution_timestamp_ms - cmd.signal_timestamp_ms

    if (!(await this.in_position({ base_asset, edge }))) {
      let spot_long_result: TradeAbstractionCloseResult_NOT_FOUND = {
        object_type: "TradeAbstractionCloseResult",
        object_class: "result",
        version: 1,
        status: "NOT_FOUND",
        http_status: 404,
        msg: `${edge}:${base_asset}: NOT_FOUND: Spot Close: there is no known long spot position on ${base_asset}, skipping close request`,
        base_asset,
        edge,
        execution_timestamp_ms,
        signal_to_execution_slippage_ms,
        action,
      }
      this.logger.result(tags, spot_long_result, "created")
      return spot_long_result
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
        this.logger.info(tags, `${prefix} cancelling stop order ${stop_order_id} on ${symbol}`)
        await this.ee.cancel_order({
          order_id: stop_order_id,
          symbol,
        })
      }
    } catch (err) {
      let msg = `Failed to cancel stop order on ${symbol} - was it cancelled manually?`
      this.logger.warn(tags, msg)
      this.logger.exception(tags, err)
      this.send_message(msg, tags)
    }

    let oco_order_id: OrderId | undefined
    try {
      /** Cancel oco order if there is one */
      oco_order_id = await this.positions_persistance.get_oco_order(spot_position_identifier)

      if (oco_order_id) {
        this.logger.info(tags, `${prefix} cancelling oco order ${oco_order_id} on ${symbol}`)
        await this.ee.cancel_oco_order({
          order_id: oco_order_id,
          symbol,
        })
      }
    } catch (err) {
      let msg = `Failed to cancel oco order ${oco_order_id} on ${symbol} - was it cancelled manually?`
      this.logger.warn(tags, msg)
      this.logger.exception(tags, err)
      this.send_message(msg, tags)
    }

    // Continue even if the attempt to cancel the stop/oco orders fails

    try {
      /** Exit the position */
      let base_amount = await this.exisiting_position_size({ base_asset, edge })
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }
      this.logger.todo({ level: "warn", ...tags }, `Can throw instead of returning Result object`)
      await this.ee.market_sell({ order_context, market_identifier, base_amount }) // throws if it fails
      // let executed_amount = // .. actually we might not have this info immediately

      let obj: TradeAbstractionCloseResult_SUCCESS = {
        object_type: "TradeAbstractionCloseResult",
        object_class: "result",
        version: 1,
        status: "SUCCESS",
        http_status: 200,
        msg: `Spot Close ${edge}:${base_asset}: SUCCESS`,
        base_asset,
        quote_asset,
        edge,
        execution_timestamp_ms,
        signal_to_execution_slippage_ms,
        action,
        // executed_quote_quantity, // TODO: add these later if we can
        // executed_base_quantity,
        // executed_price,
      }
      this.logger.result(tags, obj, "created")
      return obj
    } catch (err: any) {
      let msg = `Exception, failed to exit position on ${edge}:await ${symbol}`
      this.logger.exception(tags, err, msg)
      this.send_message(msg, tags)
      let obj: TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR = {
        object_type: "TradeAbstractionCloseResult",
        object_class: "result",
        version: 1,
        status: "INTERNAL_SERVER_ERROR",
        http_status: 500,
        err,
        msg: `Spot Close ${edge}:${base_asset}:${symbol} INTERNAL_SERVER_ERROR: ${err.msg}`,
        base_asset,
        edge,
        execution_timestamp_ms,
        signal_to_execution_slippage_ms,
        action,
      }
      this.logger.result({ ...tags, level: "error" }, obj, "created")
      return obj
    }
  }

  async move_stop(
    cmd: TradeAbstractionMoveStopCommand,
    { quote_asset }: { quote_asset: string }
  ): Promise<TradeAbstractionMoveStopResult> {
    let { action, trade_context, signal_timestamp_ms } = cmd
    let { edge, base_asset, trade_id } = trade_context
    let tags: ContextTags = { ...trade_context, action }
    let prefix: string = `Closing ${edge}:${base_asset} spot position:`

    try {
      if (!(await this.in_position({ base_asset, edge }))) {
        let execution_timestamp_ms = +Date.now()
        let signal_to_execution_slippage_ms = execution_timestamp_ms - cmd.signal_timestamp_ms
        let result: TradeAbstractionMoveStopResult_NOT_FOUND = {
          object_type: "TradeAbstractionMoveStopResult",
          object_class: "result",
          version: 1,
          trade_context: { edge, base_asset, quote_asset },
          status: "NOT_FOUND",
          http_status: 404,
          msg: `${edge}:${base_asset}: NOT_FOUND: Spot Close: there is no known long spot position on ${base_asset}, skipping close request`,
          execution_timestamp_ms,
          signal_to_execution_slippage_ms,
          action,
          signal_timestamp_ms,
        }
        this.logger.result(tags, result, "created")
        return result
      }

      /**
       * 1. Get stop order id and cancel it
       * 2. Add replacement stop
       */

      let exchange_identifier = this.get_exchange_identifier()
      let spot_position_identifier: SpotPositionIdentifier_V3 = {
        exchange_identifier,
        base_asset,
        edge,
      }

      let market_identifier = this.ee.get_market_identifier_for({ quote_asset, base_asset })
      let symbol = market_identifier.symbol
      tags = { ...tags, symbol }

      /** Refuse to continue if there is an oco order - we only implemented re-creating vanilla stops at the moment */
      let oco_order_id: OrderId | undefined
      oco_order_id = await this.positions_persistance.get_oco_order(spot_position_identifier)
      if (oco_order_id) {
        let err = new Error(
          `Not implemented to move stop when it is an OCO order (${oco_order_id}) on ${edge}:${symbol}`
        )
        this.logger.exception(tags, err)
        throw err
      }

      let stop_order_id: OrderId | undefined
      try {
        /** Cancel stop order if there is one */
        stop_order_id = await this.positions_persistance.get_stop_order(spot_position_identifier)

        if (stop_order_id) {
          if (!trade_id) {
            let order_context = await this.order_context_persistance.get_order_context_for_order({
              exchange_identifier,
              order_id: stop_order_id,
            })
            trade_id = (order_context as OrderContext_V2).trade_id
            if (trade_id) tags = { ...tags, trade_id }
          }

          this.logger.info(tags, `${prefix} cancelling stop order ${stop_order_id} on ${symbol}`)
          await this.ee.cancel_order({
            order_id: stop_order_id,
            symbol,
          })
        }
      } catch (err) {
        let msg = `Exception trying to cancel existing stop order (${stop_order_id}) on ${symbol} - was it cancelled manually?`
        this.logger.exception(tags, err)
        this.send_message(msg, tags)
        this.logger.todo(
          { level: "warn", ...tags },
          `Can throw instead of returning Result object - what is the result here if we can't cancel the existing stop?`
        )
        throw err
      }

      // Don't get here if the attempt to cancel the stop/oco orders fails
      if (!trade_id) {
        throw new Error(`Aborting move_stop as unable to determine trade_id`)
      }
      let trade_context: TradeContext = { edge, base_asset, quote_asset, trade_id }

      /** Set the new stop */
      let base_amount = await this.exisiting_position_size({ base_asset, edge })
      let order_context: OrderContext_V1 = { edge, object_type: "OrderContext", version: 1 }

      let stop_cmd: SpotStopMarketSellCommand = {
        object_type: "SpotStopMarketSellCommand",
        object_class: "command",
        order_context,
        market_identifier,
        trade_context,
        base_amount,
        trigger_price: new BigNumber(cmd.new_stop_price), // Will munge later
      }
      this.logger.command(tags, stop_cmd, "created")

      let created_stop_order = false

      let stop_result = await this.ee.stop_market_sell(stop_cmd)
      await this.positions_persistance.set_stop_order(spot_position_identifier, stop_result.order_id)
      created_stop_order = true

      let execution_timestamp_ms = +Date.now()
      let signal_to_execution_slippage_ms = execution_timestamp_ms - cmd.signal_timestamp_ms
      let obj: TradeAbstractionMoveStopResult_SUCCESS = {
        object_type: "TradeAbstractionMoveStopResult",
        object_class: "result",
        version: 1,
        trade_context,
        status: "SUCCESS",
        created_stop_order,
        http_status: 200,
        msg: `Moved Stop for ${edge}:${base_asset} to ${cmd.new_stop_price}: SUCCESS`,
        execution_timestamp_ms,
        signal_to_execution_slippage_ms: signal_to_execution_slippage_ms.toString(),
        action,
        signal_timestamp_ms,
      }
      this.logger.result(tags, obj, "created")
      return obj
    } catch (err: any) {
      let msg = `Move Stop ${edge}:${base_asset}:${quote_asset} INTERNAL_SERVER_ERROR: ${err.msg}`
      this.logger.exception(tags, err, msg)
      this.send_message(msg, tags)
      let execution_timestamp_ms = +Date.now()
      let signal_to_execution_slippage_ms = execution_timestamp_ms - cmd.signal_timestamp_ms
      let obj: TradeAbstractionMoveStopResult_INTERNAL_SERVER_ERROR = {
        object_type: "TradeAbstractionMoveStopResult",
        object_class: "result",
        version: 1,
        trade_context,
        status: "INTERNAL_SERVER_ERROR",
        http_status: 500,
        err,
        msg,
        execution_timestamp_ms,
        signal_to_execution_slippage_ms,
        action,
        signal_timestamp_ms,
      }
      this.logger.result({ ...tags, level: "error" }, obj, "created")
      return obj
    }
  }
}
