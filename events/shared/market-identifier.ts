import { ExchangeIdentifier } from "./exchange-identifier"

export interface MarketIdentifier {
  exchange_identifier: ExchangeIdentifier
  base_asset: string
  quote_asset: string
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
