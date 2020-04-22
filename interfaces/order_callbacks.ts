export interface BinanceOrderData {
  totalTradeQuantity: string; // TODO: need to mark this optional?
  symbol: string;
  orderRejectReason? : string
}

export interface OrderCallbacks {
  order_cancelled(order_id: string, data: BinanceOrderData): Promise<void>;
  order_filled(order_id: string, data: BinanceOrderData): Promise<void>;
}
