import { ExchangeIdentifier_V3 } from "./exchange-identifier"

import * as Sentry from "@sentry/node"
Sentry.init({})
export function create_position_identifier_from_tuple({
  baseAsset,
  account,
  exchange,
  exchange_type,
  edge,
}: {
  baseAsset: string
  account: "default"
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

// We need unknown for manual orders where we have no information
export type AuthorisedEdgeType = "edge60" | "undefined"

export function check_edge(edge: string | undefined): AuthorisedEdgeType {
  if (!edge) {
    Sentry.captureException(new Error(`check_edge: undefined value passed in`))
    return "undefined"
  }
  if (edge === "edge60") return "edge60"
  let msg = `Unauthorised edge: ${edge}`
  console.error(msg)
  Sentry.captureException(new Error(msg))
  return edge as AuthorisedEdgeType
}
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
