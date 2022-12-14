import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"

export interface GenericOrderCallbacks {
  order_cancelled?(data: GenericOrderData): Promise<void>
  order_filled(data: GenericOrderData): Promise<void>
  order_filled_or_partially_filled?(data: GenericOrderData): Promise<void>
  order_created?(data: GenericOrderData): Promise<void>
  order_expired?(data: GenericOrderData): Promise<void>
}
