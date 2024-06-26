// NB: Add new fields to the mongoDB upload also if they need mappying - like string decimals
export interface SpotEdgePerformanceEvent {
  object_type: "SpotEdgePerformanceEvent"
  version: 1
  edge: string
  base_asset: string
  exchange: string
  exchange_type: string
  percentage_quote_change?: number
  abs_quote_change?: string
  loss?: boolean
  entry_timestamp_ms?: number
  exit_timestamp_ms?: number
  days_in_position: number
}
