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

import { ExecutionReport, OrderRejectReason, OrderStatus_LT, OrderType_LT } from "binance-api-node"
import { AuthorisedEdgeType } from "../classes/spot/abstractions/position-identifier"
import { OrderContext_V1 } from "../classes/spot/exchanges/interfaces/spot-execution-engine"
import { ExchangeIdentifier_V3 } from "../events/shared/exchange-identifier"
import { BinanceOrderType } from "./exchange/binance/spot-orders"

// Where the fuck is executedQuoteQuant?
export interface BinanceOrderData extends ExecutionReport {
  object_type: "BinanceOrderData"
  version: 1
  exchange_identifier: ExchangeIdentifier_V3
  order_id: string
  order_is_is_client_order_id: boolean // Added by us: did we use newClientOrderId to set orderId
  orderTime: number
  totalTradeQuantity: string // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string
  side: "BUY" | "SELL"
  orderType: OrderType_LT
  isOrderWorking: boolean // for stop loss limits this is false on creation and true once triggered
  orderRejectReason: OrderRejectReason
  price: string
  stopPrice: string
  quantity: string
  orderStatus: OrderStatus_LT
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us
  edge?: AuthorisedEdgeType // Added by us
  order_context?: OrderContext_V1 // Added by us
}

export interface OrderCallbacks {
  order_cancelled?(data: BinanceOrderData): Promise<void>
  order_filled(data: BinanceOrderData): Promise<void>
  order_filled_or_partially_filled?(data: BinanceOrderData): Promise<void>
  order_created?(data: BinanceOrderData): Promise<void>
  order_expired?(data: BinanceOrderData): Promise<void>
}
