import { ExchangeIdentifier } from "./exchange-identifier"

export interface PositionIdentifier {
  exchange_identifier: ExchangeIdentifier
  symbol: string
}

export function create_position_identifier_from_tuple({
  symbol,
  account,
  exchange,
}: {
  symbol: string
  account: string
  exchange: string
}): PositionIdentifier {
  return { symbol, exchange_identifier: { exchange, account } }
}
