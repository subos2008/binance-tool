import { BinanceAlgoUtils } from "./_internal/binance_algo_utils_v2"
import { ServiceLogger } from "../../../../../../interfaces/logger"
import { strict as assert } from "assert"
import {
  MarketIdentifier_V4,
  MarketIdentifier_V5,
  MarketIdentifier_V5_with_base_asset,
} from "../../../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../../../events/shared/exchange-identifier"
import binance, { CancelOrderResult, OcoOrder, Order, TimeInForce_LT } from "binance-api-node"
import { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceExchangeInfoGetter } from "../../../../../../classes/exchanges/binance/exchange-info-getter"
import { randomUUID } from "crypto"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../../../../../lib/sentry"

import {
  SpotStopMarketSellCommand,
  SpotMarketBuyByQuoteQuantityCommand,
  SpotMarketSellCommand,
  SpotOCOSellCommand,
  SpotLimitBuyCommand,
  SpotExecutionEngineBuyResult,
  TradeContext,
  SpotStopMarketSellResult,
} from "../../../../../../interfaces/exchanges/spot-execution-engine"
import { OrderContextPersistence } from "../../../../../../classes/persistent_state/interface/order-context-persistence"
import { OrderContext_V1, OrderContext_V2 } from "../../../../../../interfaces/orders/order-context"
import { BinanceStyleSpotPrices } from "../../../../../../classes/spot/abstractions/position-identifier"
import { SendMetrics } from "../send-metrics"
import { ContextTags, TradeContextTags } from "../../../../../../interfaces/send-message"

// Binance Keys
assert(process.env.BINANCE_API_KEY)
assert(process.env.BINANCE_API_SECRET)

var ee: Binance = binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
})

//https://github.com/aloysius-pgast/crypto-exchanges-gateway/blob/2f15a88b1c7b784fc3a9cf5d4bfc6b551eccdecb/app/exchanges/binance/exchange.js#L78
// ee.getInfo().futures.

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class BinanceSpotExecutionEngine /*implements SpotExecutionEngine*/ {
  utils: BinanceAlgoUtils
  logger: ServiceLogger
  ei_getter: BinanceExchangeInfoGetter
  order_context_persistence: OrderContextPersistence
  metrics: SendMetrics

  constructor({
    logger,
    order_context_persistence,
  }: {
    logger: ServiceLogger
    order_context_persistence: OrderContextPersistence
  }) {
    assert(logger)
    this.logger = logger
    this.utils = new BinanceAlgoUtils({ logger, ee /* note global variable */ })
    this.ei_getter = new BinanceExchangeInfoGetter({ ee })
    this.order_context_persistence = order_context_persistence
    let exchange_identifier = this.get_exchange_identifier()
    this.metrics = new SendMetrics({ logger, exchange_identifier })
  }

  get_exchange_identifier(): ExchangeIdentifier_V4 {
    return {
      version: 4,
      exchange: "binance",
      exchange_type: "spot",
    }
  }

  get_raw_binance_ee() {
    return ee
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    return await this.ei_getter.get_exchange_info()
  }

  // Used when storing things like Position state
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V5_with_base_asset {
    return {
      object_type: "MarketIdentifier",
      version: 5,
      exchange_identifier: this.get_exchange_identifier(),
      symbol: `${base_asset.toUpperCase()}${quote_asset.toUpperCase()}`,
      base_asset,
      quote_asset,
    }
  }

  async base_asset_for_symbol(symbol: string): Promise<string> {
    let exchange_info = await this.get_exchange_info()
    let symbols = exchange_info.symbols
    let match = symbols.find((s) => s.symbol === symbol)
    if (!match) throw new Error(`No match for symbol ${symbol} in exchange_info symbols`)
    return match.baseAsset
  }

  async store_order_context_and_generate_clientOrderId(
    order_context: OrderContext_V1 | OrderContext_V2
  ): Promise<{ clientOrderId: string }> {
    let { edge } = order_context
    let trade_id: string | undefined
    let tags: ContextTags = { edge }
    if ("trade_id" in order_context) {
      trade_id = order_context.trade_id
      tags.trade_id = trade_id
    }
    let clientOrderId = randomUUID()
    this.logger.info(tags, `Generated clientOrderId: ${clientOrderId}`)
    try {
      await this.order_context_persistence.set_order_context_for_order({
        exchange_identifier: this.get_exchange_identifier(),
        order_id: clientOrderId,
        order_context,
      })
      return { clientOrderId }
    } catch (err) {
      this.logger.exception(tags, err, `Failed to store clientOrderId: ${clientOrderId}`)
      throw err
    }
  }

  // async market_buy_by_quote_quantity(
  //   cmd: SpotMarketBuyByQuoteQuantityCommand
  // ): Promise<SpotExecutionEngineBuyResult> {
  //   let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
  //   let result = await this.utils.create_market_buy_order_by_quote_amount({
  //     pair: cmd.market_identifier.symbol,
  //     quote_amount: cmd.quote_amount,
  //     clientOrderId,
  //   })
  //   if (result) {
  //     return {
  //       executed_quote_quantity: new BigNumber(result.cummulativeQuoteQty),
  //       // Note we use cumBase instead of executedQty for futures version..?
  //       executed_base_quantity: new BigNumber(result.executedQty),
  //       executed_price: new BigNumber(result.cummulativeQuoteQty).dividedBy(result.executedQty),
  //       execution_timestamp_ms: result.transactTime?.toString(),
  //     }
  //   }
  //   throw new Error(`Something bad happened executing market_buy_by_quote_quantity`)
  // }

  async execute_with_429_retries<T>(tags: ContextTags, func: () => Promise<T>): Promise<T> {
    let allowed_retries = 3
    do {
      try {
        let result: T = await func()
        return result
      } catch (err: any) {
        allowed_retries = allowed_retries - 1
        if (allowed_retries <= 0) throw err
        if (err.message.match(/Too many new orders/ || err.code === -1015)) {
          this.logger.exception(tags, err, `429 from Binance, sleeping and retrying`)
        } else {
          throw err
        }
      }
      await sleep(11 * 1000)
    } while (allowed_retries > 0)
    throw new Error(`Should not reach here`)
  }

  // TODO: copy 429 code from here
  async limit_buy(cmd: SpotLimitBuyCommand, trade_context: TradeContext): Promise<SpotExecutionEngineBuyResult> {
    let { market_identifier, order_context } = cmd
    let { trade_id, edge } = trade_context
    let { base_asset, symbol } = market_identifier
    let tags: TradeContextTags = { base_asset, symbol, edge, trade_id }
    let prefix = `${symbol} SpotExecutionEngineBuyResult`

    try {
      this.logger.command(tags, cmd, "received")
      let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId({
        ...cmd.order_context,
        trade_id: trade_context.trade_id,
      })
      this.logger.info(tags, `Generated clientOrderId: ${clientOrderId}`)
      let result: Order
      result = await this.utils.create_limit_buy_order({
        exchange_info: await this.get_exchange_info(),
        price: cmd.limit_price,
        pair: cmd.market_identifier.symbol,
        base_amount: cmd.base_amount,
        clientOrderId,
        timeInForce: "IOC",
      })
      this.logger.command(tags, cmd, "consumed")
      this.logger.event(tags, { object_type: "BinanceOrder", object_class: "event", ...result })
      let spot_long_result: SpotExecutionEngineBuyResult
      let executed_base_quantity = new BigNumber(result.executedQty)
      if (executed_base_quantity.isZero()) {
        spot_long_result = {
          object_type: "SpotExecutionEngineBuyResult",
          object_class: "result",
          version: 2,
          market_identifier,
          trade_context,
          status: "ENTRY_FAILED_TO_FILL",
          http_status: 200,
          msg: `${prefix}: ENTRY_FAILED_TO_FILL`,
          execution_timestamp_ms: result.transactTime || Date.now(),
        }
      } else {
        spot_long_result = {
          object_type: "SpotExecutionEngineBuyResult",
          object_class: "result",
          version: 2,
          msg: `${prefix}: FILLED`,
          market_identifier,
          order_context,
          status: "FILLED",
          http_status: 201,
          executed_quote_quantity: new BigNumber(result.cummulativeQuoteQty),
          executed_base_quantity,
          executed_price: new BigNumber(result.cummulativeQuoteQty).dividedBy(result.executedQty),
          execution_timestamp_ms: result.transactTime,
        }
      }
      this.logger.result(tags, spot_long_result, "created")
      return spot_long_result
    } catch (err: any) {
      this.logger.exception(tags, err)

      // TODO: can we do a more clean/complete job of catching exceptions from Binance?
      if (err.message.match(/Too many new orders/ || err.code === -1015)) {
        let spot_long_result: SpotExecutionEngineBuyResult = {
          object_type: "SpotExecutionEngineBuyResult",
          object_class: "result",
          version: 2,
          msg: `${prefix}:  ${err.message}`,
          err,
          market_identifier,
          order_context,
          status: "TOO_MANY_REQUESTS",
          http_status: 429,
          execution_timestamp_ms: Date.now(),
          retry_after_seconds: 11,
        }
        this.logger.result({ ...tags, level: "warn" }, spot_long_result, "created")
        return spot_long_result
      } else if (err.message.match(/Account has insufficient balance for requested action/)) {
        let spot_long_result: SpotExecutionEngineBuyResult = {
          object_type: "SpotExecutionEngineBuyResult",
          object_class: "result",
          version: 2,
          msg: `${prefix}: ${err.message}, code: ${err.code}`,
          market_identifier,
          order_context,
          status: "INSUFFICIENT_BALANCE",
          http_status: 402, // 402: Payment Required
          execution_timestamp_ms: Date.now(),
        }
        this.logger.result(tags, spot_long_result, "created")
        return spot_long_result
      } else {
        let spot_long_result: SpotExecutionEngineBuyResult = {
          object_type: "SpotExecutionEngineBuyResult",
          object_class: "result",
          version: 2,
          err,
          msg: `${prefix}: INTERNAL_SERVER_ERROR: ${err.message}`,
          market_identifier,
          order_context,
          execution_timestamp_ms: Date.now(),
          status: "INTERNAL_SERVER_ERROR",
          http_status: 500,
        }
        this.logger.result({ ...tags, level: "error" }, spot_long_result, "created")
        return spot_long_result
      }
    }
  }

  /** implemented as a stop_limit */
  // TODO: add 429 try/catch logic
  // TODO: port to return SpotExecutionEngineBuyResult
  async stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<SpotStopMarketSellResult> {
    let { edge } = cmd.order_context
    let { base_asset } = cmd.market_identifier
    let { trade_id } = cmd.trade_context
    let tags: TradeContextTags = { edge, base_asset, trade_id }

    try {
      this.metrics.stop_market_sell_request(cmd)
    } catch (err) {
      this.logger.exception(tags, err)
    }

    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId({
      ...cmd.order_context,
      trade_id,
    })
    let args = {
      exchange_info: await this.get_exchange_info(),
      pair: cmd.market_identifier.symbol,
      base_amount: cmd.base_amount,
      stop_price: cmd.trigger_price,
      limit_price: cmd.trigger_price.times(0.8),
      clientOrderId,
    }
    let call = this.utils.munge_and_create_stop_loss_limit_sell_order.bind(this.utils, args)
    // NB: this can throw 429's as it has a limited number of retries
    // TODO: add a try/catch around this function making loud complaints about FAILED_TO_CREATE_EXIT_ORDERS
    let order: Order = await this.execute_with_429_retries(tags, call)
    if (!order?.clientOrderId) {
      throw new Error(`Failed to create stop order`)
    }
    let stop_price = order.stopPrice ? new BigNumber(order.stopPrice) : cmd.trigger_price
    let result = { order_id: order.clientOrderId, stop_price, trade_context: cmd.trade_context }
    try {
      // TODO: move into the EE
      // TODO: doesn't work with exceptions
      this.metrics.stop_market_sell_result(result)
    } catch (err) {
      this.logger.exception(tags, err)
    }
    return result
  }

  // throws on failure
  async cancel_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
    this.logger.info(`Cancelling Order clientOrderId ${order_id} on symbol ${symbol}`)
    let result = await ee.cancelOrder({ symbol, origClientOrderId: order_id })
    if (result.status === "CANCELED") {
      this.logger.info(`Successfully cancelled order ${order_id}`)
      return
    }
    let msg = `Failed to cancel order ${order_id} on ${symbol}, status ${result.status}`
    this.logger.warn(msg)
    this.logger.warn(result)
    throw new Error(msg)
  }

  // throws on failure
  async cancel_oco_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
    this.logger.info(`Cancelling OCO clientOrderId ${order_id} oco order on symbol ${symbol}`)
    let result = await ee.cancelOrderOco({ symbol, listClientOrderId: order_id })
    if (result.listOrderStatus === "ALL_DONE") {
      this.logger.info(`Successfully cancelled order ${order_id}`)
      return
    }
    let msg = `Failed to cancel oco order ${order_id} on ${symbol}, status ${result.listOrderStatus}`
    this.logger.warn(msg)
    this.logger.warn(result)
    throw new Error(msg)
  }

  // TODO: add retries
  // TODO: add 429 try/catch logic
  // TODO: port to return SpotExecutionEngineBuyResult
  async market_sell(cmd: SpotMarketSellCommand): Promise<Order> {
    let trade_id: string | undefined

    // Called from /close where we don't know the trade_id yet
    if ("trade_id" in cmd.order_context) trade_id = cmd.order_context.trade_id

    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let tags: ContextTags = {
      edge: cmd.order_context.edge,
      base_asset: cmd.market_identifier.base_asset,
      symbol: cmd.market_identifier.symbol,
      trade_id,
    }
    let order: Order | undefined = await this.utils.create_market_sell_order({
      base_amount: cmd.base_amount,
      pair: cmd.market_identifier.symbol,
      clientOrderId,
    })
    if (order && order.clientOrderId) {
      // looks like success
      return order
    }
    let msg = `Failed to create market sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(tags, msg)
    this.logger.info(tags, order)
    throw new Error(msg)
  }

  // TODO: add 429 try/catch logic
  // TODO: port to return SpotExecutionEngineBuyResult
  async oco_sell_order(cmd: SpotOCOSellCommand): Promise<void> {
    let { base_asset, symbol } = cmd.market_identifier
    let tags = { base_asset, symbol, edge: cmd.order_context.edge }

    this.logger.command(tags, cmd, "received")
    let { stop_ClientOrderId, take_profit_ClientOrderId, oco_list_ClientOrderId } = cmd

    let args = {
      exchange_info: await this.get_exchange_info(),
      base_amount: cmd.base_amount,
      pair: cmd.market_identifier.symbol,
      stop_ClientOrderId,
      take_profit_ClientOrderId,
      oco_list_ClientOrderId,
      target_price: cmd.take_profit_price,
      stop_price: cmd.stop_price,
      limit_price: cmd.stop_limit_price,
    }

    let call = this.utils.munge_and_create_oco_order.bind(this.utils, args)

    // NB: this can throw 429's as it has a limited number of retries
    // TODO: add a try/catch around this function making loud complaints about FAILED_TO_CREATE_EXIT_ORDERS
    let order: OcoOrder | undefined = await this.execute_with_429_retries(tags, call)

    this.logger.event(tags, { object_type: "BinanceOrder", object_class: "event", ...order })
    if (order && order.listClientOrderId) {
      // looks like success
      return
    }
    let msg = `Failed to create oco sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(tags, msg)
    this.logger.info(tags, order)
    throw new Error(msg)
  }

  prices(): Promise<BinanceStyleSpotPrices> {
    return ee.prices()
  }
}
