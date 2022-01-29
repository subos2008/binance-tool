import { ExchangeIdentifier_V3 } from "../../events/shared/exchange-identifier"

export interface SpotPositionIdentifier {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  base_asset: string
}

