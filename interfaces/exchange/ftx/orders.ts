// // from: https://docs.ftx.com/#orders-2

// import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
// import { ExchangeUtils } from "../../../interfaces/exchange/generic/exchange-utils"
// import BigNumber from "bignumber.js"

// export type FtxWsOrderData = {
//   "id": number
//   "clientId": null | string
//   "market": string
//   "type": "limit" | "market"
//   "side": "buy" | "sell"
//   "size": BigNumber
//   "price": BigNumber
//   "reduceOnly": boolean
//   "ioc": boolean
//   "postOnly": boolean
//   "status": "closed" | string
//   "filledSize": BigNumber
//   "remainingSize": BigNumber
//   "avgFillPrice": BigNumber
// }

// export type FtxOrderWsEvent = {
//   "channel": "orders"
//   "data": FtxWsOrderData
//   "type": "update"
// }

// export interface FtxOrderCallbacks {
//   order_cancelled(order_id: string, data: FtxWsOrderData): Promise<void>
//   order_filled(order_id: string, data: FtxWsOrderData): Promise<void>
//   order_filled_or_partially_filled(order_id: string, data: FtxWsOrderData): Promise<void>
//   order_created?(order_id: string, data: FtxWsOrderData): Promise<void>
// }

// export function fromCompletedFtxOrderData(o: FtxWsOrderData, eu: ExchangeUtils): GenericOrderData {
//   if (o.status !== "closed") {
//     console.warn(`FTX order status ${o.status}: unknown mapping for GenericOrderData.orderStatus`)
//   }

//   if (o.status !== "closed") {
//     throw new Error(`FTX order status ${o.status}: order is not closed not safe for mapping`)
//   }

//   return {
//     exchange: "ftx", // name / slug of the exchange
//     // account?: string // account identifier on the exchange
//     orderId: o.id.toString(),
//     // as provided by the exchange
//     market_symbol: o.market, // pair etc - included but should be likely ignored as differs
//     baseAsset: eu.base_asset_for_market(o.market),
//     quoteAsset: eu.quote_asset_for_market(o.market),
//     side: o.side.toUpperCase() as "BUY" | "SELL",
//     orderType: o.type.toUpperCase() as "MARKET" | "LIMIT",

//     orderStatus: o.status === "closed" ? "COMPLETED" : undefined, // COMPLETED | PART... // tricky semantics here
//     // orderTime: number // timestamp, presume ms

//     totalBaseTradeQuantity: o.filledSize.toFixed(),
//     totalQuoteTradeQuantity: o.filledSize.times(o.avgFillPrice).toFixed(), // NB: this will not be perfect :-/
//     averageExecutionPrice: o.avgFillPrice.toFixed(), // Added by us
//   }
// }
