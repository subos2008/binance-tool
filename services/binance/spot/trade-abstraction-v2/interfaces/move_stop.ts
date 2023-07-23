import {
  TradeContext,
  TradeContext_with_optional_trade_id,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { Command, Result } from "../../../../../interfaces/logger"

export interface TradeAbstractionMoveStopCommand extends Command {
  object_type: "TradeAbstractionMoveStopCommand"

  /* Moving to v2 stylee */
  trade_context: TradeContext_with_optional_trade_id

  action: "move_stop"
  new_stop_price: string
  signal_timestamp_ms: number
}

export interface MoveStopResultBase extends Result {
  signal_timestamp_ms: number
  msg: string // human readable summary
}

export interface TradeAbstractionMoveStopResult_SUCCESS extends MoveStopResultBase {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  action: "move_stop"

  trade_context: TradeContext

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary
  http_status: 200 // 201: Created

  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string
}

export interface TradeAbstractionMoveStopResult_INTERNAL_SERVER_ERROR extends MoveStopResultBase {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  trade_context: TradeContext_with_optional_trade_id

  action: "move_stop"

  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionMoveStopResult_BAD_INPUTS extends MoveStopResultBase {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  // trade_context: TradeContext // tricky to get on BAD_INPUTS

  action: "move_stop"

  status: "BAD_INPUTS" // exception caught
  http_status: 400

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string
}

export interface TradeAbstractionMoveStopResult_TOO_MANY_REQUESTS extends MoveStopResultBase {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  trade_context: TradeContext_with_optional_trade_id

  status: "TOO_MANY_REQUESTS" // exception caught
  http_status: 429

  msg: string
  err: any

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string

  retry_after_seconds: number // can go to Retry-After header
}

interface TradeAbstractionMoveStopResult_UNAUTHORISED extends MoveStopResultBase {
  object_type: "TradeAbstractionMoveStopResult"
  version: 1
  trade_context: TradeContext_with_optional_trade_id

  status: "UNAUTHORISED" // atm means edge not recognised
  http_status: 403

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: string
}

export interface TradeAbstractionMoveStopResult_NOT_FOUND extends MoveStopResultBase {
  version: 1
  action: "move_stop"
  trade_context: TradeContext_with_optional_trade_id

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
