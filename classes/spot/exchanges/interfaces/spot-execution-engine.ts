import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { MarketIdentifier_V3 } from "../../../../events/shared/market-identifier"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { AuthorisedEdgeType } from "../../abstractions/position-identifier"
import { OrderId } from "../../persistence/interface/order-context-persistence"

/**
 * We need to know some info about orders when (read: before) they are executed
 * i.e. when a position is first entered we want to know which edge it should be stored as
 */
export interface OrderContext_V1 {
  object_type: 'OrderContext'
  version: 1
  edge: AuthorisedEdgeType
}

export interface SpotMarketBuyByQuoteQuantityCommand {
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  quote_amount: BigNumber
}

export interface SpotMarketSellCommand {
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V3
  base_amount: BigNumber
}

export interface SpotStopMarketSellCommand {
  order_context: OrderContext_V1
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

  base_asset_for_symbol(symbol:string) :Promise<string>

  market_buy_by_quote_quantity(
    args: SpotMarketBuyByQuoteQuantityCommand
  ): Promise<{ executed_quote_quantity: BigNumber; executed_price: BigNumber; executed_base_quantity: BigNumber }>

  get_exchange_identifier(): ExchangeIdentifier_V3

  stop_market_sell(cmd: SpotStopMarketSellCommand): Promise<{ order_id: OrderId; stop_price: BigNumber }>

  cancel_order(args: { order_id: string; symbol: string }): Promise<void>

  market_sell(cmd: SpotMarketSellCommand): Promise<void>
}
