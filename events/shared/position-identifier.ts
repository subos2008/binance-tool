import BigNumber from "bignumber.js"
import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "./exchange-identifier"

export function create_position_identifier_from_tuple({
  baseAsset,
  account,
  exchange,
  exchange_type,
  edge,
}: {
  baseAsset: string
  account: 'default'
  exchange: string
  exchange_type: "spot"
  edge: AuthorisedEdgeType
}): SpotPositionIdentifier_V3 {
  if (!(baseAsset && account && exchange))
    throw new Error(`missing element in create_position_identifier_from_tuple`)
  return {
    edge,
    base_asset: baseAsset,
    exchange_identifier: { exchange, account, type: exchange_type, version: "v3" },
  }
}

export type AuthorisedEdgeType = "edge60"

export interface SpotPositionIdentifier_V3 {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge: AuthorisedEdgeType
  base_asset: string
}

export interface SpotPositionsQuery_V3 {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge?: AuthorisedEdgeType // if edge is null return an array if there are multiple open positions
  base_asset: string
}
