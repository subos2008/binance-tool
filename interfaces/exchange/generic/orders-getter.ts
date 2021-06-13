import { GenericOrder } from "../../../types/exchange_neutral/generic_order_data"

export { GenericOrder }

export interface OrdersGetter {
  // get_open_orders(): Promise<GenericOrderData[]>
  get_open_orders_on_specific_market({ market_symbol }: { market_symbol: string }): Promise<GenericOrder[]>
}
