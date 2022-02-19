import { SpotPosition } from "../classes/spot/abstractions/spot-position"
// import { ExchangeIdentifier } from "../events/shared/exchange-identifier";

export interface Balance {
  // exchange_identifier: ExchangeIdentifier
  asset: string
  free: string
  locked: string
  quote_equivalents?: { [name: string]: string }
}

export interface Prices {
  [name: string]: string
}

export interface Portfolio {
  object_type: string
  usd_value?: string
  btc_value?: string
  balances: Balance[]
  prices?: Prices
  positions?: { [name: string]: SpotPosition }
}
