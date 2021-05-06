import { ExchangeIdentifier } from './exchange-identifier'

export interface PositionIdentifier {
  exchange_identifier: ExchangeIdentifier;
  symbol: string;
}
