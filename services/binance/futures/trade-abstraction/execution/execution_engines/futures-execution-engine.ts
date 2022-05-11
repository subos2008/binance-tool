import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { MarketIdentifier_V3 } from "../../../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../../../events/shared/exchange-identifier"
import { OrderContext_V1 } from "../../../../../../interfaces/orders/order-context"

// export interface FuturesMarketSellByQuoteQuantityCommand {
//   order_context: OrderContext_V1
//   market_identifier: MarketIdentifier_V3
//   quote_amount: BigNumber
// }

// export interface FuturesMarketSellCommand {
//   order_context: OrderContext_V1
//   market_identifier: MarketIdentifier_V3
//   base_amount: BigNumber
// }

// export interface FuturesOCOBuyCommand {
//   object_type: "FuturesOCOBuyCommand"
//   order_context: OrderContext_V1
//   market_identifier: MarketIdentifier_V3
//   base_amount: BigNumber
//   take_profit_price: BigNumber
//   stop_price: BigNumber
//   stop_limit_price: BigNumber
//   stop_ClientOrderId: string
//   take_profit_ClientOrderId: string
//   oco_list_ClientOrderId: string
// }

// export interface FuturesExecutionEngineSellResult {
//   object_type: "FuturesExecutionEngineSellResult"
//   executed_quote_quantity: BigNumber
//   executed_price: BigNumber
//   executed_base_quantity: BigNumber
//   execution_timestamp_ms: string | undefined
// }

export interface FuturesExecutionEngine {
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

  // market_sell_by_quote_quantity(args: FuturesMarketSellByQuoteQuantityCommand): Promise<FuturesExecutionEngineSellResult>
  
  // limit_sell_by_quote_quantity(args: FuturesMarketSellByQuoteQuantityCommand): Promise<FuturesExecutionEngineSellResult>

  get_exchange_identifier(): ExchangeIdentifier_V3

  // cancel_oco_order(args: { order_id: string; symbol: string }): Promise<void>

  // market_sell(cmd: FuturesMarketSellCommand): Promise<void>

  // oco_buy_order(cmd: FuturesOCOBuyCommand): Promise<void> // fitures exchanges don't have oco orders
}
