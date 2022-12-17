export type ExchangeIdentifier = {
  exchange: string
  account: string // not always present - this was supposed to be the user_id/account_id
}

export type ExchangeIdentifier_V2 = {
  version: "v2"
  exchange: string
}

export type ExchangeType = "margin" | "spot" | "futures"

export type ExchangeIdentifier_V3 = {
  version: "v3"
  exchange: string
  type: ExchangeType
  account: string // 'default' // we will want this eventually - PositionPersistence is ready for it
}

export type ExchangeIdentifier_V4 = {
  version: 4
  exchange: string
  exchange_type: ExchangeType
  // An exchange isn't identified by an account
  // account: string // 'default' // we will want this eventually - PositionPersistence is ready for it
}

export function exchange_identifier_to_redis_key_snippet(_exchange_identifier: ExchangeIdentifier_V4) {
  let exchange_identifier = ei_v4_to_v3(_exchange_identifier)
  return `${exchange_identifier.type}:${exchange_identifier.exchange}:default`
}

export function ei_v4_to_v3(ei: ExchangeIdentifier_V4): ExchangeIdentifier_V3 {
  return { version: "v3", exchange: ei.exchange, type: ei.exchange_type, account: "default" }
}
