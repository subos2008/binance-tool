import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"

export type GenericOrderStatus =
  | "CANCELED"
  | "EXPIRED"
  | "FILLED"
  | "NEW"
  | "PARTIALLY_FILLED"
  | "PENDING_CANCEL"
  | "REJECTED" // direct binance mapping
  
export type GenericOrderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER" // direct binance mapping

export type GenericOrderData = {
  // OG, created to map completed / filled orders to
  exchange_identifier: ExchangeIdentifier_V3
  orderId: string // as provided by the exchange
  market_symbol: string // pair etc - included but only use it to pass back to the exchange/ExchangeUtils as an opaque slug
  baseAsset: string
  quoteAsset: string
  side: "BUY" | "SELL"
  orderType: GenericOrderType

  orderStatus?: GenericOrderStatus
  orderTime: number // timestamp, presume ms

  totalBaseTradeQuantity: string // Not present in FTX
  totalQuoteTradeQuantity: string // Not present in FTX
  averageExecutionPrice: string // Calculated for Binance, present in FTX orders

  usd_equivalent_value?: string

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}

export type GenericOrder = {
  // created to map orders open on an exchange to
  exchange_identifier: ExchangeIdentifier_V3
  exchangeOrderId: string // as provided by the exchange
  exchangeOrderListId?: string // as provided by the exchange (for OCO orders)
  clientOrderId: string // the one we provided to the exchange if we can set/choose it
  market_symbol: string // pair etc - included but only use it to pass back to the exchange/ExchangeUtils as an opaque slug
  baseAsset: string
  quoteAsset: string
  side: "BUY" | "SELL"
  orderType: GenericOrderType
  stopPrice: string // note Binance uses "0.00000000" to mean no stopPrice

  orderStatus?: GenericOrderStatus
  orderTime: number // timestamp, presume ms. Not on binance this seems to be last updated time (partial fills?) instead of creation time

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}
