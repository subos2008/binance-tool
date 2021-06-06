// An object to pass around classes that handle generic exchange events to provide
// exchange specific services

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export type GenericOCOOderDefinition = {
  target_price: BigNumber
  stop_price: BigNumber
  base_asset_quantity: BigNumber
}

export type OCOSubOrder = {
  order_id: string
  client_order_id: string
}

export type GenericOCOOrder = {
  order_transaction_timestamp: number,
  orders: OCOSubOrder[]
  base_asset_quantity: BigNumber
}

export type GenericLimitSellOrderDefinition = {
  limit_price: BigNumber
  base_asset_quantity: BigNumber
}

export type GenericStopLimitSellOrderDefinition = {
  stop_price: BigNumber
  limit_price?: BigNumber
  base_asset_quantity: BigNumber
}

export type GenericLimitSellOrder = {
  limit_price: BigNumber
  base_asset_quantity: BigNumber
  order_id: string
}

export type GenericStopLimitSellOrder = {
  stop_price: BigNumber
  limit_price: BigNumber
  base_asset_quantity: BigNumber
  order_id: string
}

export interface MarketUtils {
  base_asset(): Promise<string>
  quote_asset(): Promise<string>
  market_symbol(): Promise<string>
  create_oco_order(order_definition: GenericOCOOderDefinition): Promise<GenericOCOOrder>
  // create_limit_sell_order(order_definition: GenericLimitSellOrderDefinition): Promise<GenericLimitSellOrder>
  create_stop_limit_sell_order(order_definition: GenericStopLimitSellOrderDefinition): Promise<GenericStopLimitSellOrder>
}
