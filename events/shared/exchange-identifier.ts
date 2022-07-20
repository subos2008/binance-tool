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
  account: string // 'default' // we will want this eventually - PositionPersistance is ready for it
}

export type ExchangeIdentifier_V4 = {
  version: 4
  exchange: string
  exchange_type: ExchangeType
  // An exchange isn't identified by an account
  // account: string // 'default' // we will want this eventually - PositionPersistance is ready for it
}

export function exchange_identifier_to_redis_key_snippet(exchange_identifier: ExchangeIdentifier_V3) {
  return `${exchange_identifier.type}:${exchange_identifier.exchange}:${exchange_identifier.account}`
}
