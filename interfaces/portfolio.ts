import BigNumber from "bignumber.js"
import { SpotPosition } from "../classes/spot/abstractions/spot-position"
import { ExchangeIdentifier_V3 } from "../events/shared/exchange-identifier"
// import { ExchangeIdentifier } from "../events/shared/exchange-identifier";

export interface Balance {
  // exchange_identifier: ExchangeIdentifier
  asset: string
  free: string
  locked: string
  quote_equivalents?: { [name: string]: string }
}

export interface Balance_with_quote_value extends Balance {
  quote_asset: string
  total_quote_asset_value: BigNumber | undefined
}

export interface FuturesBalance {
  // exchange_identifier: ExchangeIdentifier
  asset: string
  quote_equivalents?: { [name: string]: string }

  /* from Binance FuturesAsset - note there are also Positions */
  walletBalance: string
  unrealizedProfit: string
  marginBalance: string
  maintMargin: string
  initialMargin: string
  positionInitialMargin: string
  openOrderInitialMargin: string
  maxWithdrawAmount: string
  crossWalletBalance: string
  crossUnPnl: string
  availableBalance: string
  marginAvailable: boolean
  updateTime: number
}

export interface Prices {
  [name: string]: string
}

export interface Portfolio {
  object_type: string
  usd_value?: string
  balances: Balance[]
  prices?: Prices
  positions?: { [name: string]: SpotPosition }
}

export interface FuturesPortfolio {
  object_type: string
  usd_value?: string
  balances: FuturesBalance[]
  prices?: Prices
  positions?: { [name: string]: SpotPosition }
}

export interface SpotPortfolio {
  object_type: "SpotPortfolio"
  version: 1
  exchange_identifier: ExchangeIdentifier_V3
  timestamp_ms: number

  usd_value?: string
  balances: Balance[]
  prices?: Prices

  // quote_values_added: prevent decorating Balances multiple times
  quote_values_added?: string[]
}
