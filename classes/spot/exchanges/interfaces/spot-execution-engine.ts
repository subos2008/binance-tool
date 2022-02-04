import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"

export interface SpotMarketBuyByQuoteQuantityCommand {
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
}

export interface SpotStopMarketSellCommand {
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
  trigger_price: BigNumber
}

export interface SpotExecutionEngine {
  get_market_identifier_for({
    quote_asset,
    base_asset,
  }: {
    quote_asset: string
    base_asset: string
  }): MarketIdentifier_V3

  market_buy_by_quote_quantity(
    args: SpotMarketBuyByQuoteQuantityCommand
  ): Promise<{ executed_quote_quantity: BigNumber; executed_price: BigNumber; executed_base_quantity: BigNumber }>

  get_exchange_identifier(): ExchangeIdentifier_V3

  stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: string | number; stop_price: BigNumber }>

  cancel_order(args: { order_id: string; symbol: string }): Promise<void>

  market_sell(args: { symbol: string; base_amount: BigNumber }): Promise<void>
}
