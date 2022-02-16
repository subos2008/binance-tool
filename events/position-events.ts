import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "./shared/exchange-identifier"

export interface NewPositionEvent {
  object_type: string
  exchange_identifier: ExchangeIdentifier_V3
  baseAsset: string
  position_entry_timestamp_ms?: number
  position_base_size: string
  position_initial_entry_price?: string
  position_initial_quote_spent: string
  position_initial_quoteAsset: string
}
