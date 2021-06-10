import { BinanceOrderData } from "../../../interfaces/order_callbacks"
import { assert } from "console"
import { ExchangeInfo } from "binance-api-node"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"

export function fromCompletedBinanceOrderData(i: BinanceOrderData, exchange_info: ExchangeInfo): GenericOrderData {
  assert(i.orderStatus && i.orderStatus == "COMPLETED")

  let symbol_info = exchange_info.symbols.find((x) => x.symbol == i.symbol)
  if (!symbol_info)
    throw new Error(`No exchange_info for symbol ${i.symbol} found when converting Binance order to GenericOrder`)
  if (!i.averageExecutionPrice)
    throw new Error(
      `No averageExecutionPrice for symbol ${i.symbol} found when converting Binance order to GenericOrder`
    )

  return {
    exchange: "binance",
    orderId: i.orderId,
    market_symbol: i.symbol,
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
