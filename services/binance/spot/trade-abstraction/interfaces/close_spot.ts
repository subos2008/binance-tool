import { SpotPositionIdentifier_V3 } from "../../../../../classes/spot/abstractions/position-identifier"

interface CloseSpotLongResult_BASE {
  object_type: "TradeAbstractionCloseSpotLongResult"
  version: 1
  base_asset: string
  edge: string
  msg: string // human readable text for this object
  http_status: 200 | 404 
}

interface TradeAbstractionCloseSpotLongResult_INTERNAL_SERVER_ERROR extends CloseSpotLongResult_BASE {
  status: "INTERNAL_SERVER_ERROR" // exception caught

  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: string
  signal_to_execution_slippage_ms?: string
}

export interface TradeAbstractionCloseSpotLongResult_NOT_FOUND extends CloseSpotLongResult_BASE {
  status: "NOT_FOUND" // can't close a position that's not open - not an error either though
}

export interface TradeAbstractionCloseSpotLongResult_SUCCESS extends CloseSpotLongResult_BASE {
  status: "SUCCESS" // looks like a rap
  quote_asset: string
}

export type TradeAbstractionCloseSpotLongResult =
  | TradeAbstractionCloseSpotLongResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionCloseSpotLongResult_NOT_FOUND
  | TradeAbstractionCloseSpotLongResult_SUCCESS

export interface TradeAbstractionCloseLongCommand {
  base_asset: string
  edge: string
  direction: "long"
  action: "close"
}

export interface InterimSpotPositionsMetaDataPersistantStorage {
  set_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3, order_id: string): Promise<void>
  get_stop_order_id(spot_position_identifier: SpotPositionIdentifier_V3): Promise<string | null>
}
