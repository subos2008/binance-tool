import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { MarketIdentifier_V5_with_base_asset } from "../../events/shared/market-identifier"
import { OrderContext_V2 } from "../../interfaces/orders/order-context"

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
  object_type: "GenericOrderData"
  version: 2
  msg: string
  // OG, created to map completed / filled orders to
  exchange_identifier: ExchangeIdentifier_V4
  order_id: string // as provided by the exchange - would always be clientOrderId for Binance
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

  // edge?: string // Not currently added anywhere We might want to use OrderContext instead

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}

export type GenericOrderUpdate = {
  object_type: "GenericOrderUpdate" // Parallel to Data, new version
  version: 1
  msg: string

  timestamp_ms: number // timestamp, presume ms

  exchange_identifier: ExchangeIdentifier_V4
  market_identifier: MarketIdentifier_V5_with_base_asset

  order_id: string // as provided by the exchange - would always be clientOrderId for Binance, or previous client id for cancelled orders on Binance?
  side: "BUY" | "SELL"
  order_type: GenericOrderType
  order_status: GenericOrderStatus

  total_base_trade_quantity: string // Not present in FTX
  total_quote_trade_quantity: string // Not present in FTX

  // average_execution_price needs adding back
  // average_execution_price: string // Calculated for Binance, present in FTX orders

  usd_equivalent_value?: string
}

export type GenericOrder = {
  // created to map orders open on an exchange to
  exchange_identifier: ExchangeIdentifier_V3
  exchangeOrderId: string // as provided by the exchange
  exchangeOrderListId?: string // as provided by the exchange (for OCO orders)
  clientOrderId: string // the one we provided to the exchange if we can set/choose it
  order_id_is_client_order_id: boolean
  order_id: string // this will be the one to use - consider the others (*OrderId) kind of internal
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
