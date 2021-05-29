export type GenericOrderData = {
  exchange: string // name / slug of the exchange
  account?: string // account identifier on the exchange
  orderId: string // as provided by the exchange
  exchange_symbol: string // pair etc - included but should be likely ignored as differs
  baseAsset: string
  quoteAsset: string
  side: string // BUY | SELL
  orderType: string // MARKET | LIMIT

  orderStatus?: string // COMPLETED | PART...
  orderTime: number // timestamp, presume ms

  totalBaseTradeQuantity: string
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}

import { BinanceOrderData } from "../../interfaces/order_callbacks"
import * as _ from "lodash"
import { assert } from "console"
import { ExchangeInfo } from "binance-api-node"
export function fromCompletedBinanceOrderData(i: BinanceOrderData, exchange_info: ExchangeInfo): GenericOrderData {
  assert(i.orderStatus && i.orderStatus == "COMPLETED")

  let symbol_info = exchange_info.symbols.find((x) => x.symbol == i.symbol)
  if(!symbol_info) throw new Error(`No exchange_info for symbol ${i.symbol} found when converting Binance order to GenericOrder`)

  return {
    exchange: "binance",
    orderId: i.orderId,
    exchange_symbol: i.symbol,
    baseAsset: symbol_info.baseAsset,
    quoteAsset: symbol_info.quoteAsset,
    side: i.side,
    orderType: i.orderType,
    orderStatus: i.orderStatus,
    totalBaseTradeQuantity: i.totalTradeQuantity,
    totalQuoteTradeQuantity: i.totalQuoteTradeQuantity,
    averageExecutionPrice: i.averageExecutionPrice,
    orderTime: i.orderTime,
  }
}
