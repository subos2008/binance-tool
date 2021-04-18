export interface BinanceOrderData {
  orderId:string
  totalTradeQuantity: string; // NB: we might rename this to totalBaseTradeQuantity in exchange_neutral
  symbol: string;
  side:string
  orderType:string
  orderRejectReason? : string
  price?:string
  quantity?:string
  orderStatus?:string
  totalQuoteTradeQuantity: string
  averageExecutionPrice?: string // Added by us
}

export interface OrderCallbacks {
  order_cancelled(order_id: string, data: BinanceOrderData): Promise<void>;
  order_filled(order_id: string, data: BinanceOrderData): Promise<void>;
  order_filled_or_partially_filled(order_id: string, data: BinanceOrderData): Promise<void>;
  order_created?(order_id: string, data: BinanceOrderData): Promise<void>;
}
