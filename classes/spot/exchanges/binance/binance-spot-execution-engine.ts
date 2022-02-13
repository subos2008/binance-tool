import { AlgoUtils } from "./_internal/binance_algo_utils_v2"
import { Logger } from "../../../../interfaces/logger"
import { strict as assert } from "assert"
import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import binance, { CancelOrderResult, Order } from "binance-api-node"
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
  OrderContext,
} from "../interfaces/spot-execution-engine"
import { OrderToEdgeMapper } from "../../../persistent_state/order-to-edge-mapper"

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
  order_to_edge_mapper: OrderToEdgeMapper

  constructor({ logger, order_to_edge_mapper }: { logger: Logger; order_to_edge_mapper: OrderToEdgeMapper }) {
    assert(logger)
    this.logger = logger
    this.utils = new AlgoUtils({ logger, ee /* note global variable */ })
    this.ei_getter = new BinanceExchangeInfoGetter({ ee })
    this.order_to_edge_mapper = order_to_edge_mapper
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

  async store_order_context_and_generate_clientOrderId(
    order_context: OrderContext
  ): Promise<{ clientOrderId: string }> {
    let clientOrderId = randomUUID()
    await this.order_to_edge_mapper.set_edge_for_order(
      this.get_exchange_identifier(),
      clientOrderId,
      order_context.edge
    )
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

  /** implemented as a stop_limit */
  async stop_market_sell(cmd: SpotStopMarketSellCommand) {
    let { clientOrderId } = await this.store_order_context_and_generate_clientOrderId(cmd.order_context)
    let result = await this.utils.munge_and_create_stop_loss_limit_sell_order({
      exchange_info: await this.get_exchange_info(),
      pair: cmd.market_identifier.symbol,
      base_amount: cmd.base_amount,
      stop_price: cmd.trigger_price,
      limit_price: cmd.trigger_price.times(0.8),
      clientOrderId,
    })
    if (!result?.orderId) {
      throw new Error(`Failed to create stop order`)
    }
    let stop_price = result.stopPrice ? new BigNumber(result.stopPrice) : cmd.trigger_price
    return { order_id: result.orderId, stop_price }
  }

  async cancel_order({ order_id, symbol }: { symbol: string; order_id: string }): Promise<void> {
    let result = await this.utils.cancelOrder({ symbol, clientOrderId: order_id })
    if (result.status === "CANCELED") {
      this.logger.info(`Sucesfully cancelled order ${order_id}`)
      return
    }
    let msg = `Failed to cancel order ${order_id} on ${symbol}, status ${result.status}`
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
    if (order && order.orderId) {
      // looks like success
      return
    }
    let msg = `Failed to create market sell order for ${cmd.market_identifier.symbol}`
    this.logger.warn(msg)
    this.logger.info(order)
    throw new Error(msg)
  }
}
