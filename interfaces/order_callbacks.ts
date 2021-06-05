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
//   isOrderWorking: boolean;
//   isBuyerMaker: boolean;
//   totalQuoteTradeQuantity: string;
// }

export interface BinanceOrderData {
  orderId: string
  orderTime: number
  totalTradeQuantity: string // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string
  side: "BUY" | "SELL"
  orderType: "LIMIT" | "MARKET"
  orderRejectReason?: string
  price?: string
  quantity?: string
  orderStatus?: string
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us
}

export interface OrderCallbacks {
  order_cancelled?(data: BinanceOrderData): Promise<void>
  order_filled(data: BinanceOrderData): Promise<void>
  order_filled_or_partially_filled?(data: BinanceOrderData): Promise<void>
  order_created?(data: BinanceOrderData): Promise<void>
}
