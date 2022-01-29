import BigNumber from "bignumber.js"
import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "./exchange-identifier"

export interface PositionIdentifier {
  exchange_identifier: ExchangeIdentifier
  baseAsset: string
  baseAssetAmount?: BigNumber // wtf?
}

export function create_position_identifier_from_tuple({
  baseAsset,
  account,
  exchange,
}: {
  baseAsset: string
  account: string
  exchange: string
}): PositionIdentifier {
  if (!(baseAsset && account && exchange))
    throw new Error(`missing element in create_position_identifier_from_tuple`)
  return { baseAsset, exchange_identifier: { exchange, account } }
}

export type AuthorisedEdgeType = "edge60"

export interface SpotPositionIdentifier_V3 {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge: AuthorisedEdgeType
  base_asset: string
}
