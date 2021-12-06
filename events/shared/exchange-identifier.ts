export type ExchangeIdentifier = {
  exchange: string;
  account: string; // not always present
  // TODO: margin vs spot?
}

export type ExchangeIdentifier_V2 = {
  version: 'v2'
  exchange: string;
  // account: string; // not always present
  // TODO: account_type: "margin" | "spot"
}
