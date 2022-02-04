export type ExchangeIdentifier = {
  exchange: string
  account: string // not always present - this was supposed to be the user_id/account_id
}

export type ExchangeIdentifier_V2 = {
  version: "v2"
  exchange: string
}

export type ExchangeIdentifier_V3 = {
  version: "v3"
  exchange: string
  type: "margin" | "spot"
  account: string // 'default' // we will want this eventually - PositionPersistance is ready for it
}
