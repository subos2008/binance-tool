export type GenericOrderData = {
  exchange: string // name / slug of the exchange
  account?: string // account identifier on the exchange
  orderId: string // as provided by the exchange
  symbol: string; // pair etc
  side: string // BUY | SELL
  orderType: string // MARKET | LIMIT

  orderStatus?: string // COMPLETED | PART...

  totalBaseTradeQuantity: string;
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us

  // orderRejectReason?: string // we probably don't want rejected orders in generic streams
  // price?: string
  // quantity?: string
}

import { BinanceOrderData } from '../../interfaces/order_callbacks'
import * as _ from 'lodash'
import { assert } from 'console'
export function fromCompletedBinanceOrderData(i: BinanceOrderData) {
  assert(i.orderStatus && i.orderStatus == 'COMPLETED')

  return {
    exchange: 'binance',
    orderId: i.orderId,
    symbol: i.symbol,
    side: i.side,
    orderType: i.orderType,
    orderStatus: i.orderStatus,
    totalBaseTradeQuantity: i.totalTradeQuantity,
    totalQuoteTradeQuantity: i.totalQuoteTradeQuantity,
    averageExecutionPrice: i. averageExecutionPrice
  }
}
