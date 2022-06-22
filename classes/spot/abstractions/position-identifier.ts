import { ExchangeIdentifier_V3 } from "../../../events/shared/exchange-identifier"

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
export type AuthorisedEdgeType = "edge60" | "undefined" | "edge61" | "edge62" | "edge63"
const authorised_edges: AuthorisedEdgeType[] = ["edge60", "edge61", "edge62", "edge63"]

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
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge: AuthorisedEdgeType
  base_asset: string
}

export interface SpotPositionsQuery_V3 {
  exchange_identifier: ExchangeIdentifier_V3 // yeah exchange, not market, for spot - but market for futures
  edge?: AuthorisedEdgeType // if edge is null return an array if there are multiple open positions
  base_asset: string
}

export type BinanceStyleSpotPrices = {
  [index: string]: string
}
