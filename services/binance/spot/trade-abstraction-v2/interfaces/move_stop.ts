import { Command, Result } from "../../../../../interfaces/logger"

export interface TradeAbstractionMoveStopCommand extends Command {
  object_type: "TradeAbstractionMoveStopCommand"
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: string
  trade_id: string

  direction: "long"
  action: "move_stop"
  new_stop_price: string
  signal_timestamp_ms: number
}

export interface TradeAbstractionMoveStopResult_SUCCESS extends Result {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string
  trade_id: string
  action: "move_stop"

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary
  http_status: 200 // 201: Created

  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string
}

interface TradeAbstractionMoveStopResult_INTERNAL_SERVER_ERROR extends Result {
  object_type: "TradeAbstractionMoveStopResult"
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

interface TradeAbstractionMoveStopResult_BAD_INPUTS extends Result {
  object_type: "TradeAbstractionMoveStopResult"
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

export interface TradeAbstractionMoveStopResult_TOO_MANY_REQUESTS extends Result {
  object_type: "TradeAbstractionMoveStopResult"
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

interface TradeAbstractionMoveStopResult_UNAUTHORISED extends Result {
  object_type: "TradeAbstractionMoveStopResult"
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

export interface TradeAbstractionMoveStopResult_NOT_FOUND extends Result {
  version: 1
  action: 'move_stop'
  base_asset: string
  edge: string
  status: "NOT_FOUND" // can't close a position that's not open - not an error either though
  http_status: 404

  signal_to_execution_slippage_ms: number
  execution_timestamp_ms: number
}

export type TradeAbstractionMoveStopResult =
  | TradeAbstractionMoveStopResult_SUCCESS
  | TradeAbstractionMoveStopResult_BAD_INPUTS
  | TradeAbstractionMoveStopResult_UNAUTHORISED
  | TradeAbstractionMoveStopResult_TOO_MANY_REQUESTS
  | TradeAbstractionMoveStopResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionMoveStopResult_NOT_FOUND
  | 
