import BigNumber from "bignumber.js"
import { ExchangeIdentifier } from "./exchange-identifier"

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
  return { baseAsset, exchange_identifier: { exchange, account } }
}
