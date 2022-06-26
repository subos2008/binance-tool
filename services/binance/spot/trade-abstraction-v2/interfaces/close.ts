import { SpotPositionIdentifier_V3 } from "../../../../../classes/spot/abstractions/position-identifier"

interface CloseResult_BASE {
  object_type: "TradeAbstractionCloseResult"
  version: 1
  base_asset: string
  edge: string
  msg: string // human readable text for this object
}

interface TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR extends CloseResult_BASE {
  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string
}

export interface TradeAbstractionCloseResult_NOT_FOUND extends CloseResult_BASE {
  status: "NOT_FOUND" // can't close a position that's not open - not an error either though
  http_status: 404

  signal_to_execution_slippage_ms: number
  execution_timestamp_ms: number
}

export interface TradeAbstractionCloseResult_SUCCESS extends CloseResult_BASE {
  status: "SUCCESS" // looks like a rap
  http_status: 200
  quote_asset: string

  signal_to_execution_slippage_ms: number
  execution_timestamp_ms: number
}

export type TradeAbstractionCloseResult =
  | TradeAbstractionCloseResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionCloseResult_NOT_FOUND
  | TradeAbstractionCloseResult_SUCCESS

export interface TradeAbstractionCloseCommand {
  base_asset: string
  edge: string
  direction: "long"
  action: "close"
  signal_timestamp_ms: number
}

export interface InterimSpotPositionsMetaDataPersistantStorage {
  set_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3, order_id: string): Promise<void>
  get_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3): Promise<string | null>
}
