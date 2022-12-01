import BigNumber from "bignumber.js"
import { randomUUID } from "node:crypto"
import { Command, Result } from "../../../../../interfaces/logger"

export interface TradeAbstractionOpenLongCommand extends Command {
  object_type: "TradeAbstractionOpenLongCommand"
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
  trade_id: string
}

export function generate_trade_id(args: {
  base_asset: string
  edge: string
  direction: "long" | "short"
  signal_timestamp_ms: number
}): string {
  return `${args.edge}-${args.base_asset}-${args.direction}-` + randomUUID()
}

export interface TradeAbstractionOpenLongCommand_StopLimitExit extends Command {
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
  trade_id: string
  edge_percentage_stop: BigNumber
  edge_percentage_buy_limit: BigNumber
}

export interface TradeAbstractionOpenLongCommand_OCO_Exit extends Command {
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
  trade_id: string
  edge_percentage_stop: BigNumber
  edge_percentage_stop_limit: BigNumber
  edge_percentage_take_profit: BigNumber
  edge_percentage_buy_limit: BigNumber
}

interface TradeAbstractionOpenSpotLongResult_SUCCESS extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string
  trade_id: string

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary
  http_status: 201 // 201: Created

  // signal
  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price: string // can be null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

interface TradeAbstractionOpenSpotLongResult_INTERNAL_SERVER_ERROR extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_BAD_INPUTS extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset?: string
  quote_asset?: string
  edge?: string
  // trade_id: string // we were generating the id from the inputs

  direction?: string
  action?: string

  status: "BAD_INPUTS" // exception caught
  http_status: 400

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_ENTRY_FAILED_TO_FILL extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill
  http_status: 200 // 200: Success... but not 201, so not actually created

  msg: string // human readable summary
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string

  // Buy execution
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

export interface TradeAbstractionOpenSpotLongResult_TOO_MANY_REQUESTS extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "TOO_MANY_REQUESTS" // exception caught
  http_status: 429

  msg: string
  err: any

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string

  retry_after_seconds: number // can go to Retry-After header
}

interface TradeAbstractionOpenSpotLongResult_UNAUTHORISED extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "UNAUTHORISED" // atm means edge not recognised
  http_status: 403

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_TRADING_IN_ASSET_PROHIBITED extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "TRADING_IN_ASSET_PROHIBITED" // some assets like stable coins we refuse to enter
  http_status: 403 // Double check this is correct when online sometime

  msg: string
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_ALREADY_IN_POSITION extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position
  http_status: 409 // 409: Conflict

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

// console.warn(`What http_status do we want for INSUFFICIENT_BALANCE?`)
interface TradeAbstractionOpenSpotLongResult_INSUFFICIENT_BALANCE extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "INSUFFICIENT_BALANCE"
  http_status: 402 // 402: Payment Required

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenSpotLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS extends Result {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string
  trade_id: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created
  http_status: 200 // Help What Should I be... Let's say 200, instead of 201. Processed but didn't create anything

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: number // TODO: should all these be optional?
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenLongResult =
  | TradeAbstractionOpenSpotLongResult_SUCCESS
  | TradeAbstractionOpenSpotLongResult_BAD_INPUTS
  | TradeAbstractionOpenSpotLongResult_UNAUTHORISED
  | TradeAbstractionOpenSpotLongResult_TRADING_IN_ASSET_PROHIBITED
  | TradeAbstractionOpenSpotLongResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenSpotLongResult_INSUFFICIENT_BALANCE
  | TradeAbstractionOpenSpotLongResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenSpotLongResult_TOO_MANY_REQUESTS
  | TradeAbstractionOpenSpotLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
  | TradeAbstractionOpenSpotLongResult_INTERNAL_SERVER_ERROR
