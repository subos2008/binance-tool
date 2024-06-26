// from binance-api-node
// export interface ExecutionReport extends Message {
//   symbol: string;
//   newClientOrderId: string;
//   originalClientOrderId: string;
//   side: OrderSide;
//   orderType: OrderType;
//   timeInForce: TimeInForce;
//   quantity: string;
//   price: string;
//   executionType: ExecutionType;
//   stopPrice: string;
//   icebergQuantity: string;
//   orderStatus: OrderStatus;
//   orderRejectReason: string;
//   orderId: number;
//   orderTime: number;
//   lastTradeQuantity: string;
//   totalTradeQuantity: string;
//   priceLastTrade: string;
//   commission: string;
//   commissionAsset: string;
//   tradeId: number;
//   isOrderWorking: boolean; // for stop loss limits this is false on creation and true once triggered
//   isBuyerMaker: boolean;
//   totalQuoteTradeQuantity: string;
// }

import {
  ExecutionReport,
  FuturesOrderType_LT,
  OrderRejectReason,
  OrderStatus_LT,
  OrderType_LT,
} from "binance-api-node"
import { ExchangeIdentifier_V4, ExchangeType } from "../../../events/shared/exchange-identifier"
import { PureEvent } from "../../logger"
import { OrderContext_V1 } from "../../orders/order-context"

// BinanceExecutionReport - very lightweight ingestion. Minimal modification possible for us to log and
// queue events we ingest via the websocket.
export interface BinanceExecutionReport extends ExecutionReport, PureEvent {
  object_type: "BinanceExecutionReport"
  exchange_identifier: ExchangeIdentifier_V4
  version: 1
}

export interface ExecutionReportCallbacks {
  process_execution_report(data: ExecutionReport): Promise<void>
}

// BinanceOrderData is Depricated in Favour of BinanceExecutionReport (local) or GenericOrderData/GenericOrderData
// Where the fuck is executedQuoteQuant?
export interface BinanceOrderData /* extends ExecutionReport */ {
  object_type: "BinanceOrderData"
  version: 1
  msg?: string

  exchange_identifier: ExchangeIdentifier_V4
  exchange_type: ExchangeType
  order_id: string
  order_is_is_client_order_id: boolean // Added by us: did we use newClientOrderId to set orderId
  orderTime: number
  totalTradeQuantity: string // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string
  side: "BUY" | "SELL"
  orderType: OrderType_LT | FuturesOrderType_LT // looks like the API wrapper incorrectly changed their type here to FuturesOrderType_LT
  isOrderWorking: boolean // for stop loss limits this is false on creation and true once triggered
  orderRejectReason: OrderRejectReason
  price: string
  stopPrice: string
  quantity: string
  orderStatus: OrderStatus_LT
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us
  // edge?: string // Added by us // 2022 - removed again, we want to queue these raw events without any dependency on redis
  // order_context?: OrderContext_V1 // Added by us // 2022 - removed again, we want to queue these raw events without any dependency on redis
}
export interface FuturesBinanceOrderData /* extends OrderUpdate */ {
  object_type: "FuturesBinanceOrderData"
  version: 1
  exchange_identifier: ExchangeIdentifier_V4
  exchange_type: ExchangeType
  order_id: string
  order_is_is_client_order_id: boolean // Added by us: did we use newClientOrderId to set orderId
  orderTime: number
  totalTradeQuantity: string // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string
  side: "BUY" | "SELL"
  orderType: FuturesOrderType_LT
  // isOrderWorking: boolean // for stop loss limits this is false on creation and true once triggered
  // orderRejectReason: OrderRejectReason
  price: string
  stopPrice: string
  quantity: string
  orderStatus: OrderStatus_LT
  // totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us
  edge?: string // Added by us
  order_context?: OrderContext_V1 // Added by us
}

export interface OrderCallbacks {
  order_cancelled?(data: BinanceOrderData): Promise<void>
  order_filled(data: BinanceOrderData): Promise<void>
  order_filled_or_partially_filled?(data: BinanceOrderData): Promise<void>
  order_created?(data: BinanceOrderData): Promise<void>
  order_expired?(data: BinanceOrderData): Promise<void>
}

export interface FuturesOrderCallbacks {
  order_cancelled?(data: FuturesBinanceOrderData): Promise<void>
  order_filled(data: FuturesBinanceOrderData): Promise<void>
  order_filled_or_partially_filled?(data: FuturesBinanceOrderData): Promise<void>
  order_created?(data: FuturesBinanceOrderData): Promise<void>
  order_expired?(data: FuturesBinanceOrderData): Promise<void>
}
