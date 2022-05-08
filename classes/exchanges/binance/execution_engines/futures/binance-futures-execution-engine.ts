import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}
import * as Sentry from "@sentry/node"
Sentry.init({})

import { AlgoUtils } from "../spot/_internal/binance_algo_utils_v2"
import { Logger } from "../../../../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import binance, { CancelOrderResult, FuturesOrder, NewFuturesOrder, NewOcoOrder, NewOrderMarketQuote, OcoOrder, Order, OrderSide, OrderType } from "binance-api-node"
import { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceFuturesExchangeInfoGetter } from "../../exchange-info-getter"
import { randomUUID } from "crypto"


// interface BinanceFuturesStopLimitOrderCommand {}

import {
  FuturesExecutionEngine,
  FuturesMarketSellByQuoteQuantityCommand,
  FuturesOCOBuyCommand,
  FuturesExecutionEngineSellResult,
} from "../../../../../interfaces/exchanges/futures-execution-engine"
import { OrderContextPersistence } from "../../../../spot/persistence/interface/order-context-persistence"
import { OrderContext_V1 } from "../../../../../interfaces/orders/order-context"

// Binance Keys
assert(process.env.BINANCE_API_KEY)
assert(process.env.BINANCE_API_SECRET)

var ee: Binance = binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
})

export class BinanceFuturesExecutionEngine implements FuturesExecutionEngine {
  logger: Logger
  ei_getter: BinanceFuturesExchangeInfoGetter
  order_context_persistence: OrderContextPersistence
  utils :AlgoUtils

  constructor({
    logger,
    order_context_persistence,
  }: {
    logger: Logger
    order_context_persistence: OrderContextPersistence
  }) {
    assert(logger)
    this.logger = logger
    this.ei_getter = new BinanceFuturesExchangeInfoGetter({ ee })
    this.order_context_persistence = order_context_persistence
    this.utils = new AlgoUtils({logger,ee})
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

  // Used when storing things like Position state
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V3 {
    return {
      version: "v3",
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
    order_context: OrderContext_V1
  ): Promise<{ clientOrderId: string }> {
    let clientOrderId = randomUUID()
    await this.order_context_persistence.set_order_context_for_order({
      exchange_identifier: this.get_exchange_identifier(),
      order_id: clientOrderId,
      order_context,
    })
    return { clientOrderId }
  }

  async market_sell_by_quote_quantity(
    cmd: FuturesMarketSellByQuoteQuantityCommand
  ): Promise<FuturesExecutionEngineSellResult> {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let side = OrderSide.SELL
    let type = OrderType.MARKET
    let quoteOrderQty = cmd.quote_amount.toFixed()
    let symbol = cmd.market_identifier.symbol
    let args: NewOrderMarketQuote = {
      side,
      symbol,
      type,
      quoteOrderQty,
      newClientOrderId: clientOrderId,
    }
    this.logger.info(`Creating ${symbol} ${type} ${side} ORDER for quoteOrderQty ${quoteOrderQty}`)
    let result :FuturesOrder = await ee.futuresOrder(args)
    this.logger.info(`order id: ${result.clientOrderId}`)
    assert.equal(result.clientOrderId, clientOrderId)

    /**
     * export interface FuturesOrder {
     *   clientOrderId: string
     *   cumQty: string
     *   cumQuote: string
     *   executedQty: string
     *   orderId: number
     *   avgPrice: string
     *   origQty: string
     *   price: string
     *   reduceOnly: boolean
     *   side: OrderSide_LT
     *   positionSide: PositionSide_LT
     *   status: OrderStatus_LT
     *   stopPrice: string
     *   closePosition: boolean
     *   symbol: string
     *   timeInForce: TimeInForce_LT
     *   type: OrderType_LT
     *   origType: OrderType_LT
     *   activatePrice: string
     *   priceRate: string
     *   updateTime: number
     *   workingType: WorkingType_LT
     * }
     */
    if (result) {
      return {
        object_type: "FuturesExecutionEngineSellResult",
        executed_quote_quantity: new BigNumber(result.cumQuote),
        executed_base_quantity: new BigNumber(result.cumQty),
        executed_price: new BigNumber(result.cumQuote).dividedBy(result.cumQty),
        execution_timestamp_ms: result.updateTime?.toString(),
      }
    }
    throw new Error(`Something bad happened executing market_sell_by_quote_quantity`)
  }

  // // throws on failure
  // async cancel_oco_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
  //   this.logger.info(`Cancelling clientOrderId ${order_id} oco order on symbol ${symbol}`)
  //   let result = await ee.cancelOrderOco({ symbol, listClientOrderId: order_id })
  //   if (result.listOrderStatus === "ALL_DONE") {
  //     this.logger.info(`Sucesfully cancelled order ${order_id}`)
  //     return
  //   }
  //   let msg = `Failed to cancel oco order ${order_id} on ${symbol}, status ${result.listOrderStatus}`
  //   this.logger.warn(msg)
  //   this.logger.warn(result)
  //   throw new Error(msg)
  // }

  async oco_buy_order(cmd: FuturesOCOBuyCommand): Promise<void> {
    this.logger.object(cmd)
    let { stop_ClientOrderId, take_profit_ClientOrderId, oco_list_ClientOrderId } = cmd

    let exchange_info = await this.get_exchange_info()
    let base_amount = cmd.base_amount
    let symbol = cmd.market_identifier.symbol
    let target_price = cmd.take_profit_price
    let stop_price = cmd.stop_price
    let limit_price = cmd.stop_limit_price

    assert(symbol && target_price && base_amount && stop_price && limit_price)
    assert(BigNumber.isBigNumber(base_amount))
    assert(BigNumber.isBigNumber(target_price))
    assert(BigNumber.isBigNumber(limit_price))

    try {
      base_amount = this.utils.munge_amount_and_check_notionals({
        exchange_info,
        pair: symbol,
        base_amount,
        stop_price,
        limit_price,
        target_price,
      })
      stop_price = this.utils.munge_and_check_price({ exchange_info, symbol: symbol, price: stop_price })
      limit_price = this.utils.munge_and_check_price({ exchange_info, symbol: symbol, price: limit_price })
      target_price = this.utils.munge_and_check_price({ exchange_info, symbol: symbol, price: target_price })
      let quantity = base_amount.toFixed()
      //   export interface NewOcoOrder {
      //     symbol: string;
      //     listClientOrderId?: string;
      //     side: OrderSide;
      //     quantity: string;
      //     limitClientOrderId?: string;
      //     price: string;
      //     limitIcebergQty?: string;
      //     stopClientOrderId?: string;
      //     stopPrice: string;
      //     stopLimitPrice?: string;
      //     stopIcebergQty?: string;
      //     stopLimitTimeInForce?: TimeInForce;
      //     newOrderRespType?: NewOrderRespType;
      //     recvWindow?: number;
      //     useServerTime?: boolean;
      // }
      let stop_order_args: NewFuturesOrder = {
        useServerTime: true,
        symbol: symbol,
        side: OrderSide.BUY,
        reduceOnly: "true",
        quantity,
        // price: target_price.toFixed(),
        stopPrice: stop_price.toFixed(),
        stopLimitPrice: limit_price.toFixed(),
        listClientOrderId: oco_list_ClientOrderId,
        limitClientOrderId: take_profit_ClientOrderId,
        stopClientOrderId: stop_ClientOrderId,
      }
      this.logger.info(
        `${symbol} Creating OCO ORDER for ${quantity} at target ${target_price.toFixed()} stop triggered at ${stop_price.toFixed()}`
      )
      //   export interface OcoOrder {
      //     orderListId: number;
      //     contingencyType: ContingencyType;
      //     listStatusType: ListStatusType;
      //     listOrderStatus: ListOrderStatus;
      //     listClientOrderId: string;
      //     transactionTime: number;
      //     symbol: string;
      //     orders: Order[];
      //     orderReports: Order[];
      // }

      // Actually we don't want oco orders, preferably reduce only orders on both sides
      // AND I guess we need to clean up those orders when the position
      let order: FuturesOrder = await ee.futuresOrder(args)

    /**
     *   export interface OcoOrder {
     *     orderListId: number
     *     contingencyType: OcoOrderType.CONTINGENCY_TYPE
     *     listStatusType: ListStatusType_LT
     *     listOrderStatus: ListOrderStatus_LT
     *     listClientOrderId: string
     *     transactionTime: number
     *     symbol: string
     *     orders: Order[]
     *     orderReports: Order[]
     * }
     */
    this.logger.object({ object_type: "BinanceOrder", ...order })
    if (order && order.listClientOrderId) {
      // looks like success
      return
    }
    let msg = `Failed to create oco sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(msg)
    this.logger.info(order)
    throw new Error(msg)
  }
} catch (err: any) {
  let context = { symbol, class: "AlgoUtils", method: "munge_and_create_oco_order" }
  Sentry.captureException(err, {
    tags: context,
  })
  this.logger.error(context, `OCO error: ${err.body}`)
  this.logger.error({ err })
  throw err
}
}
