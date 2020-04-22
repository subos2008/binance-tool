export interface BinanceOrderData {
  orderId:string
  totalTradeQuantity: string; // TODO: need to mark this optional?
  symbol: string;
  side:string
  orderType:string
  orderRejectReason? : string
  price?:string
  quantity?:string
  orderStatus?:string
}

export interface OrderCallbacks {
  order_cancelled(order_id: string, data: BinanceOrderData): Promise<void>;
  order_filled(order_id: string, data: BinanceOrderData): Promise<void>;
}
