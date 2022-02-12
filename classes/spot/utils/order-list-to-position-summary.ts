import { strict as assert } from "assert"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"

type PositionSummary = {
  initial_entry_timestamp_ms?: number
  position_closed_timestamp_ms?: number

  /** can be added if quote value was calculated or the same for all orders  */
  quote_asset?: string
  total_quote_invested?: string
  total_quote_returned?: string
  net_quote?: string
  percentage_quote_change?: number // use a float for this, it's not for real accounting
}

class OrderListToPositionSummary {
  static get_summary(orders: GenericOrderData[]) {
    let result : PositionSummary = {}
    // Sort orders by timestamp
    orders = orders.sort((a,b) => a.orderTime - b.orderTime)
    for(const order of orders) {

    }
  }
}
