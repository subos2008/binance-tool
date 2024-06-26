import {
  ExchangeIdentifier,
  ExchangeIdentifier_V2,
  ExchangeIdentifier_V3,
  ExchangeIdentifier_V4,
} from "./exchange-identifier"

export interface MarketIdentifier {
  exchange_identifier: ExchangeIdentifier
  base_asset: string
  quote_asset: string
}

export interface MarketIdentifier_V2 {
  version: "v2"
  exchange_identifier: ExchangeIdentifier_V2
  base_asset?: string
  quote_asset?: string
  symbol: string
}
export interface MarketIdentifier_V3 {
  version: "v3"
  exchange_identifier: ExchangeIdentifier_V3
  base_asset?: string
  quote_asset?: string
  symbol: string
}

export interface MarketIdentifier_V4 {
  object_type: "MarketIdentifier"
  version: 4
  exchange_identifier: ExchangeIdentifier_V3
  base_asset?: string
  quote_asset?: string
  symbol: string
}

export interface MarketIdentifier_V5 {
  object_type: "MarketIdentifier"
  version: 5
  exchange_identifier: ExchangeIdentifier_V4
  base_asset?: string
  quote_asset?: string
  symbol: string
}

export interface MarketIdentifier_V5_with_base_asset {
  object_type: "MarketIdentifier"
  version: 5
  exchange_identifier: ExchangeIdentifier_V4
  base_asset: string
  quote_asset?: string
  symbol: string
}

export function create_market_identifier_from_tuple({
  base_asset,
  quote_asset,
  account,
  exchange,
}: {
  base_asset: string
  quote_asset: string
  account: string
  exchange: string
}): MarketIdentifier {
  return { quote_asset, base_asset, exchange_identifier: { exchange, account } }
}
