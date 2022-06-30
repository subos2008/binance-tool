import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderContext_V1 } from "../orders/order-context"
import { OrderId } from "../../classes/persistent_state/interface/order-context-persistence"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"
import { BinanceStyleSpotPrices } from "../../classes/spot/abstractions/position-identifier"

export interface SpotMarketBuyByQuoteQuantityCommand {
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
}

export interface SpotLimitBuyCommand {
  object_type: "SpotLimitBuyCommand"
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
  limit_price: BigNumber
  timeInForce: "IOC"
}

export interface SpotMarketSellCommand {
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
}

export interface SpotStopMarketSellCommand {
  object_type: "SpotStopMarketSellCommand"
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
  trigger_price: BigNumber
}

export interface SpotOCOSellCommand {
  object_type: "SpotOCOSellCommand"
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
  take_profit_price: BigNumber
  stop_price: BigNumber
  stop_limit_price: BigNumber
  stop_ClientOrderId: string
  take_profit_ClientOrderId: string
  oco_list_ClientOrderId: string
}

interface SpotExecutionEngineBuyResult_SUCCESS {
  object_type: "SpotExecutionEngineBuyResult"
  version: 2
  market_identifier: MarketIdentifier_V3
  order_context: OrderContext_V1
  status: "SUCCESS"
  http_status: 201
  msg: string
  executed_quote_quantity: BigNumber
  executed_price: BigNumber
  executed_base_quantity: BigNumber
  execution_timestamp_ms: number | undefined
}

interface SpotExecutionEngineBuyResult_INSUFFICIENT_BALANCE {
  object_type: "SpotExecutionEngineBuyResult"
  version: 2
  market_identifier: MarketIdentifier_V3
  order_context: OrderContext_V1
  msg: string
  status: "INSUFFICIENT_BALANCE"
  http_status: 402 // 402: Payment Required
  execution_timestamp_ms: number | undefined
}

interface SpotExecutionEngineBuyResult_INTERNAL_SERVER_ERROR {
  object_type: "SpotExecutionEngineBuyResult"
  version: 2
  market_identifier: MarketIdentifier_V3
  order_context: OrderContext_V1
  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500
  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here
  execution_timestamp_ms: number
}

export type SpotExecutionEngineBuyResult =
  | SpotExecutionEngineBuyResult_SUCCESS
  | SpotExecutionEngineBuyResult_INSUFFICIENT_BALANCE
  | SpotExecutionEngineBuyResult_INTERNAL_SERVER_ERROR

export interface SpotExecutionEngine {
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V3

  base_asset_for_symbol(symbol: string): Promise<string>

  // Generate a suitable clientOrderId for the exchange
  store_order_context_and_generate_clientOrderId(
    order_context: OrderContext_V1
  ): Promise<{ clientOrderId: string }>

  // This was getting 4% slippage on Binance, vs <0.5% on limit buys
  // market_buy_by_quote_quantity(args: SpotMarketBuyByQuoteQuantityCommand): Promise<SpotExecutionEngineBuyResult>

  limit_buy(args: SpotLimitBuyCommand): Promise<SpotExecutionEngineBuyResult>

  get_exchange_identifier(): ExchangeIdentifier_V3

  stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: OrderId; stop_price: BigNumber }>

  cancel_order(args: { order_id: string; symbol: string }): Promise<void>
  cancel_oco_order(args: { order_id: string; symbol: string }): Promise<void>

  market_sell(cmd: SpotMarketSellCommand): Promise<void>

  oco_sell_order(cmd: SpotOCOSellCommand): Promise<void>

  // This is more of a query - we want caching and perhaps a different 'query' interface
  prices(): Promise<BinanceStyleSpotPrices>
}
