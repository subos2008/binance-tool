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

import { AuthorisedEdgeType } from "../classes/spot/abstractions/position-identifier"
import { OrderContext_V1 } from "../classes/spot/exchanges/interfaces/spot-execution-engine"
import { BinanceOrderType } from "./exchange/binance/spot-orders"

export interface BinanceOrderData {
  object_type: "BinanceOrderData"
  version: 1
  order_id: string
  orderTime: number
  totalTradeQuantity: string // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string
  side: "BUY" | "SELL"
  orderType: BinanceOrderType
  isOrderWorking: boolean // for stop loss limits this is false on creation and true once triggered
  orderRejectReason?: string
  price?: string
  stopPrice?: string
  quantity?: string
  orderStatus?: string
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
