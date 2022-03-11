import { AlgoUtils } from "./_internal/binance_algo_utils_v2"
import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import binance, { CancelOrderResult, OcoOrder, Order } from "binance-api-node"
import { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceExchangeInfoGetter } from "../../../exchanges/binance/exchange-info-getter"
import { randomUUID } from "crypto"
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

interface BinanceSpotStopLimitOrderCommand {}

import {
  SpotExecutionEngine,
  SpotStopMarketSellCommand,
  SpotMarketBuyByQuoteQuantityCommand,
  SpotMarketSellCommand,
  OrderContext_V1,
  SpotOCOSellCommand,
  SpotLimitBuyCommand,
} from "../interfaces/spot-execution-engine"
import { OrderContextPersistence } from "../../persistence/interface/order-context-persistence"

// Binance Keys
assert(process.env.BINANCE_API_KEY)
assert(process.env.BINANCE_API_SECRET)

var ee: Binance = binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
})

export class BinanceSpotExecutionEngine implements SpotExecutionEngine {
  utils: AlgoUtils
  logger: Logger
  ei_getter: BinanceExchangeInfoGetter
  order_context_persistence: OrderContextPersistence

  constructor({
    logger,
    order_context_persistence,
  }: {
    logger: Logger
    order_context_persistence: OrderContextPersistence
  }) {
    assert(logger)
    this.logger = logger
    this.utils = new AlgoUtils({ logger, ee /* note global variable */ })
    this.ei_getter = new BinanceExchangeInfoGetter({ ee })
    this.order_context_persistence = order_context_persistence
  }

  get_exchange_identifier(): ExchangeIdentifier_V3 {
    return {
      version: "v3",
      exchange: "binance",
      type: "spot",
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

  async market_buy_by_quote_quantity(cmd: SpotMarketBuyByQuoteQuantityCommand): Promise<{
    executed_quote_quantity: BigNumber
    executed_base_quantity: BigNumber
    executed_price: BigNumber
  }> {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let result = await this.utils.create_market_buy_order_by_quote_amount({
      pair: cmd.market_identifier.symbol,
      quote_amount: cmd.quote_amount,
      clientOrderId,
    })
    if (result) {
      return {
        executed_quote_quantity: new BigNumber(result.cummulativeQuoteQty),
        executed_base_quantity: new BigNumber(result.executedQty),
        executed_price: new BigNumber(result.cummulativeQuoteQty).dividedBy(result.executedQty),
      }
    }
    throw new Error(`Something bad happened executing market_buy_by_quote_quantity`)
  }

  async limit_buy(cmd: SpotLimitBuyCommand): Promise<{
    executed_quote_quantity: BigNumber
    executed_price: BigNumber
    executed_base_quantity: BigNumber
  }> {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let result = await this.utils.create_limit_buy_order({
      exchange_info: await this.get_exchange_info(),
      price: cmd.limit_price,
      pair: cmd.market_identifier.symbol,
      base_amount: cmd.base_amount,
      clientOrderId,
    })
    if (result) {
      return {
        executed_quote_quantity: new BigNumber(result.cummulativeQuoteQty),
        executed_base_quantity: new BigNumber(result.executedQty),
        executed_price: new BigNumber(result.cummulativeQuoteQty).dividedBy(result.executedQty),
      }
    }
    throw new Error(`Something bad happened executing market_buy_by_quote_quantity`)
  }

  /** implemented as a stop_limit */
  async stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: string; stop_price: BigNumber }> {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let result = await this.utils.munge_and_create_stop_loss_limit_sell_order({
      exchange_info: await this.get_exchange_info(),
      pair: cmd.market_identifier.symbol,
      base_amount: cmd.base_amount,
      stop_price: cmd.trigger_price,
      limit_price: cmd.trigger_price.times(0.8),
      clientOrderId,
    })
    if (!result?.clientOrderId) {
      throw new Error(`Failed to create stop order`)
    }
    let stop_price = result.stopPrice ? new BigNumber(result.stopPrice) : cmd.trigger_price
    return { order_id: result.clientOrderId, stop_price }
  }

  // throws on failure
  async cancel_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
    this.logger.info(`Cancelling clientOrderId ${order_id} on symbol ${symbol}`)
    let result = await ee.cancelOrder({ symbol, origClientOrderId: order_id })
    if (result.status === "CANCELED") {
      this.logger.info(`Sucesfully cancelled order ${order_id}`)
      return
    }
    let msg = `Failed to cancel order ${order_id} on ${symbol}, status ${result.status}`
    this.logger.warn(msg)
    this.logger.warn(result)
    throw new Error(msg)
  }

  // throws on failure
  async cancel_oco_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
    this.logger.info(`Cancelling clientOrderId ${order_id} oco order on symbol ${symbol}`)
    let result = await ee.cancelOrderOco({ symbol, listClientOrderId: order_id })
    if (result.listOrderStatus === "ALL_DONE") {
      this.logger.info(`Sucesfully cancelled order ${order_id}`)
      return
    }
    let msg = `Failed to cancel oco order ${order_id} on ${symbol}, status ${result.listOrderStatus}`
    this.logger.warn(msg)
    this.logger.warn(result)
    throw new Error(msg)
  }

  async market_sell(cmd: SpotMarketSellCommand): Promise<void> {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let order: Order | undefined = await this.utils.create_market_sell_order({
      base_amount: cmd.base_amount,
      pair: cmd.market_identifier.symbol,
      clientOrderId,
    })
    if (order && order.clientOrderId) {
      // looks like success
      return
    }
    let msg = `Failed to create market sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(msg)
    this.logger.info(order)
    throw new Error(msg)
  }

  async oco_sell_order(cmd: SpotOCOSellCommand): Promise<void> {
    let { stop_ClientOrderId, take_profit_ClientOrderId, oco_list_ClientOrderId } = cmd

    let order: OcoOrder | undefined = await this.utils.munge_and_create_oco_order({
      exchange_info: await this.get_exchange_info(),
      base_amount: cmd.base_amount,
      pair: cmd.market_identifier.symbol,
      stop_ClientOrderId,
      take_profit_ClientOrderId,
      oco_list_ClientOrderId,
      target_price: cmd.take_profit_price,
      stop_price: cmd.stop_price,
      limit_price: cmd.stop_limit_price,
    })
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
    if (order && order.listClientOrderId) {
      // looks like success
      return
    }
    let msg = `Failed to create oco sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(msg)
    this.logger.info(order)
    throw new Error(msg)
  }
}
