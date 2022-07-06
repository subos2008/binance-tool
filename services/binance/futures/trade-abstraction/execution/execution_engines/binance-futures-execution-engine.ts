import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import * as Sentry from "@sentry/node"
Sentry.init({})

import { Logger } from "../../../../../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../../../events/shared/exchange-identifier"
import binance, { FuturesOrder, NewFuturesOrder, OrderSide, OrderType } from "binance-api-node"
import { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceFuturesExchangeInfoGetter } from "../../../../../../classes/exchanges/binance/exchange-info-getter"
import { randomUUID } from "crypto"

// interface BinanceFuturesStopLimitOrderCommand {}

import { OrderContextPersistence_V2 } from "../../../../../../classes/persistent_state/interface/order-context-persistence"
import { OrderContext_V2 } from "../../../../../../interfaces/orders/order-context"
import { BinanceStyleSpotPrices } from "../../../../../../classes/spot/abstractions/position-identifier"
import { TradeAbstractionOpenShortResult } from "../../interfaces/short"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "../../interfaces/close"

// Binance Keys
assert(process.env.BINANCE_API_KEY)
assert(process.env.BINANCE_API_SECRET)

var ee: Binance = binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
})

export interface TradeAbstractionOpenSpotLongCommand__StopLimitExit {
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
  edge_percentage_stop: BigNumber
  edge_percentage_buy_limit: BigNumber
}

export interface TradeAbstractionOpenSpotLongCommand_OCO_Exit {
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
  edge_percentage_stop: BigNumber
  edge_percentage_stop_limit: BigNumber
  edge_percentage_take_profit: BigNumber
  edge_percentage_buy_limit: BigNumber
}

export interface LimitSellByQuoteQuantityCommand {
  order_context: OrderContext_V2
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
  sell_limit_price: BigNumber
  take_profit_price: BigNumber
  stop_price: BigNumber
}

export interface LimitSellByQuoteQuantityWithTPandSLCommand extends LimitSellByQuoteQuantityCommand {
  take_profit_price: BigNumber
  stop_price: BigNumber
}

export class BinanceFuturesExecutionEngine {
  logger: Logger
  ei_getter: BinanceFuturesExchangeInfoGetter
  order_context_persistence: OrderContextPersistence_V2

  constructor({
    logger,
    order_context_persistence,
  }: {
    logger: Logger
    order_context_persistence: OrderContextPersistence_V2
  }) {
    assert(logger)
    this.logger = logger
    this.ei_getter = new BinanceFuturesExchangeInfoGetter({ ee })
    this.order_context_persistence = order_context_persistence
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return {
      version: "v3",
      exchange: "binance",
      type: "futures",
      account: "default",
    }
  }

  get_raw_binance_ee() {
    return ee
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    return await this.ei_getter.get_exchange_info()
  }

  async prices(): Promise<BinanceStyleSpotPrices> {
    return ee.futuresPrices()
  }

  // Used when storing things like Position state
  async get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): Promise<MarketIdentifier_V3> {
    let exchange_info = await this.get_exchange_info()
    let symbols = exchange_info.symbols
    let match = symbols.find(
      (s) => s.baseAsset === base_asset.toUpperCase() && s.quoteAsset == quote_asset.toUpperCase()
    )
    if (!match) throw new Error(`No match for symbol ${base_asset}:${quote_asset} in exchange_info symbols`)
    let symbol = match.symbol

    return {
      version: "v3",
      exchange_identifier: this.get_exchange_identifier(),
      symbol,
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
    order_context: OrderContext_V2
  ): Promise<{ clientOrderId: string }> {
    let clientOrderId = randomUUID()
    await this.order_context_persistence.set_order_context_for_order({
      exchange_identifier: this.get_exchange_identifier(),
      order_id: clientOrderId,
      order_context,
    })
    return { clientOrderId }
  }

  async close(
    tags: { base_asset: string; quote_asset: string; edge: string },
    cmd: TradeAbstractionCloseCommand,
    args: { market_identifier: MarketIdentifier_V3; order_context: OrderContext_V2 }
  ): Promise<TradeAbstractionCloseResult> {
    let prefix = `${args.market_identifier.symbol}: `

    let err = new Error(`Not implemented: close`)
    let result: TradeAbstractionCloseResult = {
      object_type: "TradeAbstractionCloseResult",
      version: 1,
      err,
      msg: `${prefix}: NOT_IMPLEMENTED: ${err.message}`,
      execution_timestamp_ms: Date.now(),
      status: "INTERNAL_SERVER_ERROR",
      http_status: 500,
      base_asset: tags.base_asset,
      edge: tags.edge,
    }
    this.logger.error(result)
    return result

    // try {
    //   // let side = OrderSide.SELL

    //   let { base_asset, edge, quote_asset } = tags

    //   let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(args.order_context)
    //   let symbol = args.market_identifier.symbol

    //   /* docs: https://binance-docs.github.io/apidocs/futures/en/#new-order-trade */

    //   let type = OrderType.MARKET
    //   let close_cmd: NewFuturesOrder = {
    //     side,
    //     symbol,
    //     type,
    //     newClientOrderId: clientOrderId,
    //     reduceOnly: "true",
    //   }
    //   this.logger.object({ object_type: "BinanceNewFuturesOrder", ...buy_order_cmd })

    //   this.logger.info(`Creating ${symbol} ${type} ${side} ORDER for quoteOrderQty ${cmd.quote_amount}`)
    //   let buy_order: FuturesOrder = await ee.futuresOrder(buy_order_cmd)
    //   this.logger.object({ object_type: "BinanceFuturesOrder", ...buy_order })

    //   let execution_timestamp_ms: number = buy_order.updateTime

    //   let entry_result: TradeAbstractionOpenShortResult = {
    //     object_type: "TradeAbstractionOpenShortResult",
    //     version: 1,
    //     msg: `${prefix}: SUCCESS: Entry Phase`,
    //     status: "SUCCESS",
    //     http_status: 201,

    //     base_asset,
    //     quote_asset,
    //     edge,

    //     // MISSING:
    //     // trigger_price?: string
    //     execution_timestamp_ms,
    //     // signal_to_execution_slippage_ms?: number,

    //     // Buy execution
    //     buy_filled: true,
    //     executed_quote_quantity: buy_order.cumQuote,
    //     executed_base_quantity: buy_order.executedQty,
    //     executed_price: buy_order.avgPrice,

    //     created_stop_order: false,
    //     created_take_profit_order: false,
    //   }
    //   this.logger.info(entry_result)
    //   return entry_result
    // } catch (err: any) {
    //   // TODO: can we do a more clean/complete job of catching exceptions from Binance?
    //   if ((err.message = ~/Account has insufficient balance for requested action/)) {
    //     let entry_result: TradeAbstractionOpenShortResult = {
    //       object_type: "TradeAbstractionOpenShortResult",
    //       version: 1,
    //       msg: `${prefix}:  Account has insufficient balance`,
    //       status: "INSUFFICIENT_BALANCE",
    //       http_status: 402, // 402: Payment Required
    //       execution_timestamp_ms: Date.now(),
    //       base_asset: tags.base_asset,
    //       edge: tags.edge,
    //       buy_filled: false,
    //     }
    //     this.logger.info(entry_result)
    //     return entry_result
    //   } else {
    //     let entry_result: TradeAbstractionOpenShortResult = {
    //       object_type: "TradeAbstractionOpenShortResult",
    //       version: 1,
    //       err,
    //       msg: `${prefix}: INTERNAL_SERVER_ERROR: ${err.message}`,
    //       execution_timestamp_ms: Date.now(),
    //       status: "INTERNAL_SERVER_ERROR",
    //       http_status: 500,
    //       base_asset: tags.base_asset,
    //       edge: tags.edge,
    //     }
    //     this.logger.error(entry_result)
    //     return entry_result
    //   }
    // }
  }

  async limit_sell_by_quote_quantity(
    tags: { base_asset: string; quote_asset: string; edge: string },
    cmd: LimitSellByQuoteQuantityCommand
  ): Promise<TradeAbstractionOpenShortResult> {
    let prefix = `${cmd.market_identifier.symbol}: `

    try {
      let side = OrderSide.SELL
      let type = OrderType.LIMIT

      let { base_asset, edge, quote_asset } = tags

      let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
      let symbol = cmd.market_identifier.symbol
      let base_amount = cmd.quote_amount.dividedBy(cmd.sell_limit_price)
      /* docs: https://binance-docs.github.io/apidocs/futures/en/#new-order-trade */

      // TODO: munge limitPrice and quantity
      let quantity = base_amount.toFixed(8)

      let buy_order_cmd: NewFuturesOrder = {
        side,
        symbol,
        type,
        quantity,
        price: cmd.sell_limit_price.toNumber(),
        newClientOrderId: clientOrderId,
        timeInForce: "IOC",
        reduceOnly: "false",
      }
      this.logger.object({ object_type: "BinanceNewFuturesOrder", ...buy_order_cmd })

      this.logger.info(`Creating ${symbol} ${type} ${side} ORDER for quoteOrderQty ${cmd.quote_amount}`)
      let buy_order: FuturesOrder = await ee.futuresOrder(buy_order_cmd)
      this.logger.object({ object_type: "BinanceFuturesOrder", ...buy_order })

      let execution_timestamp_ms: number = buy_order.updateTime

      let entry_result: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        msg: `${prefix}: SUCCESS: Entry Phase`,
        status: "SUCCESS",
        http_status: 201,

        base_asset,
        quote_asset,
        edge,

        // MISSING:
        // trigger_price?: string
        execution_timestamp_ms,
        // signal_to_execution_slippage_ms?: number,

        // Buy execution
        buy_filled: true,
        executed_quote_quantity: buy_order.cumQuote,
        executed_base_quantity: buy_order.executedQty,
        executed_price: buy_order.avgPrice,

        created_stop_order: false,
        created_take_profit_order: false,
      }
      this.logger.info(entry_result)
      return entry_result
    } catch (err: any) {
      // TODO: can we do a more clean/complete job of catching exceptions from Binance?
      if ((err.message = ~/Account has insufficient balance for requested action/)) {
        let entry_result: TradeAbstractionOpenShortResult = {
          object_type: "TradeAbstractionOpenShortResult",
          version: 1,
          msg: `${prefix}:  Account has insufficient balance`,
          status: "INSUFFICIENT_BALANCE",
          http_status: 402, // 402: Payment Required
          execution_timestamp_ms: Date.now(),
          base_asset: tags.base_asset,
          edge: tags.edge,
          buy_filled: false,
          created_stop_order: false,
          created_take_profit_order: false,
        }
        this.logger.info(entry_result)
        return entry_result
      } else {
        let entry_result: TradeAbstractionOpenShortResult = {
          object_type: "TradeAbstractionOpenShortResult",
          version: 1,
          err,
          msg: `${prefix}: INTERNAL_SERVER_ERROR: ${err.message}`,
          execution_timestamp_ms: Date.now(),
          status: "INTERNAL_SERVER_ERROR",
          http_status: 500,
          base_asset: tags.base_asset,
          edge: tags.edge,
          created_stop_order: false,
          created_take_profit_order: false,
        }
        this.logger.error(entry_result)
        return entry_result
      }
    }
  }

  async limit_sell_by_quote_quantity_with_market_tp_and_sl(
    tags: { base_asset: string; quote_asset: string; edge: string },
    cmd: LimitSellByQuoteQuantityWithTPandSLCommand
    // other: { trigger_price: string; signal_timestamp_ms: number }
  ): Promise<TradeAbstractionOpenShortResult> {
    /**
     * processing of entry order result could be detached - as in we get the order result from AMQP
     * instead of via the return promise.
     */
    let buy_result: TradeAbstractionOpenShortResult = await this.limit_sell_by_quote_quantity(tags, cmd)

    if (buy_result.status !== "SUCCESS") {
      return buy_result
    }

    let prefix = `${cmd.market_identifier.symbol}: `

    // Create two orders - STOP_MARKET and TAKE_PROFIT_MARKET

    /** TODO: Add STOP */
    let created_stop_order = false
    let created_take_profit_order = false
    try {
      {
        let side = OrderSide.BUY
        let symbol = cmd.market_identifier.symbol

        let { clientOrderId: stop_ClientOrderId } = await this.store_order_context_and_generate_clientOrderId(
          cmd.order_context
        )
        let type = OrderType.STOP_MARKET
        let stop_order_cmd: NewFuturesOrder = {
          side,
          symbol,
          type,
          stopPrice: cmd.sell_limit_price.toNumber(), // Used with STOP/STOP_MARKET or TAKE_PROFIT/TAKE_PROFIT_MARKET orders.
          newClientOrderId: stop_ClientOrderId,
          closePosition: "true",
        }
        this.logger.object({ object_type: "BinanceNewFuturesOrder", ...stop_order_cmd })
        this.logger.info(`Creating ${symbol} ${type} ${side} ORDER (closePosition)}`)
        // https://binance-docs.github.io/apidocs/futures/en/#new-order-trade
        let stop_order: FuturesOrder = await ee.futuresOrder(stop_order_cmd)
        this.logger.object({ object_type: "BinanceFuturesOrder", ...stop_order })
        created_stop_order = true
      }

      /** TODO: Add TP */
      {
        let side = OrderSide.BUY
        let symbol = cmd.market_identifier.symbol

        let { clientOrderId: take_profit_ClientOrderId } =
          await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
        let type = OrderType.TAKE_PROFIT_MARKET
        let take_profit_order_cmd: NewFuturesOrder = {
          side,
          symbol,
          type,
          stopPrice: cmd.sell_limit_price.toNumber(), // Used with STOP/STOP_MARKET or TAKE_PROFIT/TAKE_PROFIT_MARKET orders.
          newClientOrderId: take_profit_ClientOrderId,
          closePosition: "true",
        }
        this.logger.object({ object_type: "BinanceNewFuturesOrder", ...take_profit_order_cmd })
        this.logger.info(`Creating ${symbol} ${type} ${side} ORDER (closePosition)}`)
        // https://binance-docs.github.io/apidocs/futures/en/#new-order-trade
        let take_profit_order: FuturesOrder = await ee.futuresOrder(take_profit_order_cmd)
        this.logger.object({ object_type: "BinanceFuturesOrder", ...take_profit_order })
        created_take_profit_order = true
      }

      let { base_asset, quote_asset, edge } = tags
      let { executed_quote_quantity, executed_base_quantity, executed_price } = buy_result

      // TODO: copy in code from the other classes here - we should have a bunch of constructions of return types
      let result: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        msg: `${prefix}: SUCCESS: Entry and added SL, TP`,
        status: "SUCCESS",
        http_status: 201,

        base_asset,
        quote_asset,
        edge,

        // MISSING:
        // trigger_price?: string
        execution_timestamp_ms: Date.now(), // TODO: start vs finished execution timestamps..?
        // signal_to_execution_slippage_ms?: number,

        // Buy execution
        buy_filled: true,
        executed_quote_quantity,
        executed_base_quantity,
        executed_price,

        created_stop_order,
        created_take_profit_order,
      }

      this.logger.object(result)
      return result
    } catch (err) {
      throw new Error(`TODO: close position and return ABORTED_FAILED_TO_CREATE_EXIT_ORDERS`)
      //TODO: close position and return ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
    }
  }
}
