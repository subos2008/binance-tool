import { BinanceOrderData } from "../../../interfaces/order_callbacks"
import { strict as assert } from "assert"
import { ExchangeInfo, OrderStatus, QueryOrderResult } from "binance-api-node"
import {
  GenericOrder,
  GenericOrderData,
  GenericOrderStatus,
  GenericOrderType,
} from "../../../types/exchange_neutral/generic_order_data"
import { BinanceExchangeInfoGetter } from "../../../classes/exchanges/binance/exchange-info-getter"
import { ExchangeIdentifier } from "../../../events/shared/exchange-identifier"

export function fromCompletedBinanceOrderData(i: BinanceOrderData, exchange_info: ExchangeInfo): GenericOrderData {
  assert(i.orderStatus && i.orderStatus == "FILLED", `orderStatus (${i.orderStatus}) is not FILLED`)

  let symbol_info = exchange_info.symbols.find((x) => x.symbol == i.symbol)
  if (!symbol_info)
    throw new Error(`No exchange_info for symbol ${i.symbol} found when converting Binance order to GenericOrder`)
  if (!i.averageExecutionPrice)
    throw new Error(
      `No averageExecutionPrice for symbol ${i.symbol} found when converting Binance order to GenericOrder`
    )

  let generic: GenericOrderData = {
    exchange: "binance",
    orderId: i.orderId,
    market_symbol: i.symbol,
    baseAsset: symbol_info.baseAsset,
    quoteAsset: symbol_info.quoteAsset,
    side: i.side,
    orderType: i.orderType,
    totalBaseTradeQuantity: i.totalTradeQuantity,
    totalQuoteTradeQuantity: i.totalQuoteTradeQuantity,
    averageExecutionPrice: i.averageExecutionPrice,
    orderTime: i.orderTime,
  }
  if (i.orderStatus)
    generic.orderStatus = map_binance_order_status_to_generic_order_status(i.orderStatus as OrderStatus)
  return generic
}

function map_binance_order_type_to_generic_order_type(i: BinanceOrderType): GenericOrderType {
  if (i === "LIMIT") return "LIMIT"
  if (i === "MARKET") return "MARKET"
  if (i === "STOP_LOSS") return "STOP_LOSS"
  if (i === "STOP_LOSS_LIMIT") return "STOP_LOSS_LIMIT"
  if (i === "TAKE_PROFIT") return "TAKE_PROFIT"
  if (i === "TAKE_PROFIT_LIMIT") return "TAKE_PROFIT_LIMIT"
  if (i === "LIMIT_MAKER") return "LIMIT_MAKER"
  throw new Error(`Do not know how to map binance order type ${i} to generic order type`)
}

function map_binance_order_status_to_generic_order_status(i: OrderStatus): GenericOrderStatus {
  if (i === "CANCELED") return "CANCELED"
  if (i === "EXPIRED") return "EXPIRED"
  if (i === "FILLED") return "FILLED"
  if (i === "NEW") return "NEW"
  if (i === "PARTIALLY_FILLED") return "PARTIALLY_FILLED"
  if (i === "PENDING_CANCEL") return "PENDING_CANCEL"
  if (i === "REJECTED") return "REJECTED"
  throw new Error(`Do not know how to map binance order status ${i} to generic order status`)
}

// From https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#general-info-on-limits
export type BinanceOrderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER"

export async function fromBinanceQueryOrderResult({
  query_order_result,
  exchange_info_getter,
}: {
  exchange_info_getter: BinanceExchangeInfoGetter
  query_order_result: QueryOrderResult
}): Promise<GenericOrder> {
  let i = query_order_result
  let exchange_info: ExchangeInfo = await exchange_info_getter.get_exchange_info()
  let symbol_info = exchange_info.symbols.find((x) => x.symbol == i.symbol)
  if (!symbol_info)
    throw new Error(`No exchange_info for symbol ${i.symbol} found when converting Binance order to GenericOrder`)

  if (i.orderListId !== -1) {
    console.error(`OCO order in fromBinanceQueryOrderResult`)
  }
  return {
    exchange: 'binance',
    exchangeOrderId: i.orderId.toString(),
    clientOrderId: i.clientOrderId,
    market_symbol: i.symbol,
    baseAsset: symbol_info.baseAsset,
    quoteAsset: symbol_info.quoteAsset,
    side: i.side,
    orderType: map_binance_order_type_to_generic_order_type(i.type as BinanceOrderType),
    orderStatus: map_binance_order_status_to_generic_order_status(i.status),
    orderTime: i.updateTime,
  }
}
