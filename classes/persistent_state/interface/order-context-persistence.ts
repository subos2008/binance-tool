import { BigNumber } from "bignumber.js"
import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"
import { OrderContext_V1, OrderContext_V2 } from "../../../interfaces/orders/order-context"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export type OrderId = string

export interface OrderContextPersistence {
  set_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
    order_context: OrderContext_V1
  }): Promise<void>

  // throws if not found, there are valid situations for this like manually created orders
  // so ALWAYS wrap this in a try ... catch block
  get_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
  }): Promise<OrderContext_V1>
}

export interface OrderContextPersistence_V2 {
  set_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
    order_context: OrderContext_V2
  }): Promise<void>

  // throws if not found, there are valid situations for this like manually created orders
  // so ALWAYS wrap this in a try ... catch block
  get_order_context_for_order(args: {
    exchange_identifier: ExchangeIdentifier_V3
    order_id: OrderId
  }): Promise<OrderContext_V2 | OrderContext_V1>
}
