import { SpotPositionIdentifier_V3 } from "../../../../../classes/spot/abstractions/position-identifier"

interface CloseResult_BASE {
  object_type: "TradeAbstractionCloseResult"
  version: 1
  action: "close"
  msg: string // human readable text for this object

  // signal
  trigger_price?: string

  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR extends CloseResult_BASE {
  base_asset: string
  edge: string
  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

export interface TradeAbstractionCloseResult_NOT_FOUND extends CloseResult_BASE {
  base_asset: string
  edge: string
  status: "NOT_FOUND" // can't close a position that's not open - not an error either though
  http_status: 404

  signal_to_execution_slippage_ms: number
  execution_timestamp_ms: number
}

export interface TradeAbstractionCloseResult_SUCCESS extends CloseResult_BASE {
  base_asset: string
  edge: string
  status: "SUCCESS" // looks like a rap
  http_status: 200
  quote_asset: string

  // execution
  executed_quote_quantity?: string // TODO: add later
  executed_base_quantity?: string // TODO: add later
  executed_price?: string // TODO: add later
  signal_to_execution_slippage_ms: number
  execution_timestamp_ms: number
}

interface TradeAbstractionCloseResult_BAD_INPUTS extends CloseResult_BASE {
  base_asset?: string
  quote_asset: string
  edge?: string

  status: "BAD_INPUTS" // exception caught
  http_status: 400

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

export type TradeAbstractionCloseResult =
  | TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionCloseResult_NOT_FOUND
  | TradeAbstractionCloseResult_SUCCESS
  | TradeAbstractionCloseResult_BAD_INPUTS

export interface TradeAbstractionCloseCommand {
  object_type: "TradeAbstractionCloseCommand"
  version: 1
  base_asset: string
  edge: string
  action: "close"

  // signal
  signal_timestamp_ms: number
  trigger_price?: string
}

export interface InterimSpotPositionsMetaDataPersistantStorage {
  set_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3, order_id: string): Promise<void>
  get_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3): Promise<string | null>
}
