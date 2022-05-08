import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderContext_V1 } from "../orders/order-context"
import { OrderId } from "../../classes/spot/persistence/interface/order-context-persistence"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"

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

export interface SpotExecutionEngineBuyResult {
  executed_quote_quantity: BigNumber
  executed_price: BigNumber
  executed_base_quantity: BigNumber
  execution_timestamp_ms: string | undefined
}

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

  market_buy_by_quote_quantity(args: SpotMarketBuyByQuoteQuantityCommand): Promise<SpotExecutionEngineBuyResult>

  limit_buy(args: SpotLimitBuyCommand): Promise<SpotExecutionEngineBuyResult>

  get_exchange_identifier(): ExchangeIdentifier_V3

  stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: OrderId; stop_price: BigNumber }>

  cancel_order(args: { order_id: string; symbol: string }): Promise<void>
  cancel_oco_order(args: { order_id: string; symbol: string }): Promise<void>

  market_sell(cmd: SpotMarketSellCommand): Promise<void>

  oco_sell_order(cmd: SpotOCOSellCommand): Promise<void>
}
