// TAS level
// export interface TradeAbstractionOpenLongCommand {
//   object_type: "TradeAbstractionOpenLongCommand"
//   base_asset: string
//   quote_asset?: string // added by the TAS before it hits the EE
//   edge: string
//   direction: "long"
//   action: "open"
//   trigger_price?: string
//   signal_timestamp_ms: number
// }

import { MarketIdentifier_V4 } from "../../../../../events/shared/market-identifier"
import { OrderContext_V1 } from "../../../../../interfaces/orders/order-context"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export interface TradeAbstractionOpenShortCommand {
  object_type: "TradeAbstractionOpenShortCommand"
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "short"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
}

export interface LimitSellByQuoteQuantityWithTPandSLCommand {
  object_type: "LimitSellByQuoteQuantityWithTPandSLCommand"
  version: 1
  order_context: OrderContext_V1
  market_identifier: MarketIdentifier_V4
  quote_amount: BigNumber
  sell_limit_price: BigNumber
  take_profit_price: BigNumber
  stop_price: BigNumber
}

// let short_entry_cmd: LimitSellByQuoteQuantityWithTPandSLCommand = {
//   object_type: "LimitSellByQuoteQuantityWithTPandSLCommand",
//   version: 1,
//   order_context,
//   market_identifier,
//   quote_amount,
//   sell_limit_price,
//   take_profit_price,
//   stop_price,
// }

interface TradeAbstractionOpenShortResult_SUCCESS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary

  // signal
  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

interface TradeAbstractionOpenShortResult_BAD_INPUTS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset?: string
  quote_asset?: string
  edge?: string

  status: "BAD_INPUTS" // exception caught
  http_status: 400

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_INTERNAL_SERVER_ERROR {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INTERNAL_SERVER_ERROR" // exception caught

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_ENTRY_FAILED_TO_FILL {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill

  msg: string // human readable summary
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string
  http_status: 200

  // Buy execution
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}
interface TradeAbstractionOpenShortResult_UNAUTHORISED {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "UNAUTHORISED" // atm means edge not recognised

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_TRADING_IN_ASSET_PROHIBITED {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "TRADING_IN_ASSET_PROHIBITED" // some assets like stable coins we refuse to enter

  msg: string
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_ALREADY_IN_POSITION {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}
interface TradeAbstractionOpenShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenShortResult =
  | TradeAbstractionOpenShortResult_SUCCESS
  | TradeAbstractionOpenShortResult_BAD_INPUTS
  | TradeAbstractionOpenShortResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionOpenShortResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenShortResult_UNAUTHORISED
  | TradeAbstractionOpenShortResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
  | TradeAbstractionOpenShortResult_TRADING_IN_ASSET_PROHIBITED
