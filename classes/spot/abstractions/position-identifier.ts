import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../events/shared/exchange-identifier"

import Sentry from "../../../lib/sentry"

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
  edge: string
}): SpotPositionIdentifier_V3 {
  if (!(baseAsset && account && exchange))
    throw new Error(`missing element in create_position_identifier_from_tuple`)
  return {
    edge,
    base_asset: baseAsset,
    exchange_identifier: { exchange, exchange_type, version: 4 },
  }
}

// We need unknown for manual orders where we have no information
export type AuthorisedEdgeType = "undefined" | "edge62" | "edge70"
const authorised_edges: AuthorisedEdgeType[] = ["edge62", "edge70"]

export function is_authorised_edge(edge: string): boolean {
  let authorised = authorised_edges.includes(edge as AuthorisedEdgeType)
  // console.log(`is_authorised_edge: checking if edge '${edge}' is authorised: ${authorised}`)
  if (!authorised) console.warn(`Edge '${edge} unauthorised, allowed edges are: ${authorised_edges.join(", ")}`)
  return authorised
}

/** if it doesn't throw then whatever it returns is the valid edge string we are using */
export function check_edge(edge: string | undefined): AuthorisedEdgeType {
  if (edge && is_authorised_edge(edge)) {
    return edge as AuthorisedEdgeType
  }
  if (!edge) {
    let err = new Error(`check_edge: undefined passed in`)
    Sentry.captureException(err)
    console.error(err)
    // return "undefined"
    throw err
  }
  let msg = `check_edge: Unauthorised edge: '${edge}', allowed edges: ${authorised_edges.join(", ")}`
  let err = new Error(msg)
  console.error(err)
  Sentry.captureException(err)
  throw err
}
export interface SpotPositionIdentifier_V3 {
  exchange_identifier: ExchangeIdentifier_V4 // yeah exchange, not market, for spot - but market for futures
  edge: string
  base_asset: string
}

export interface SpotPositionsQuery_V3 {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge?: string // if edge is null return an array if there are multiple open positions
  base_asset: string
}

export type BinanceStyleSpotPrices = {
  [index: string]: string
}
