export type GenericOrderData = {
  exchange: string // name / slug of the exchange
  account?: string // account identifier on the exchange
  orderId: string // as provided by the exchange
  market_symbol: string // pair etc - included but only use it to pass back to the exchange/ExchangeUtils as an opaque slug
  baseAsset: string
  quoteAsset: string
  side: "BUY" | "SELL"
  orderType: "MARKET" | "LIMIT"

  orderStatus?: string // COMPLETED | PART...
  orderTime?: number // timestamp, presume ms

  totalBaseTradeQuantity: string
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}
