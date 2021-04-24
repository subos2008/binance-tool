import { ExchangeIdentifier } from './shared/exchange-identifier'

export interface NewPositionEvent {
  event_type: string;
  exchange_identifier: ExchangeIdentifier
  symbol: string;
  // position_entry_timestamp: number
  position_base_size: string
}
