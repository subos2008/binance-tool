import { ExchangeType } from "../events/shared/exchange-identifier"

export type SendMessageFunc = (msg: string, tags?: ContextTags) => void

// TODO: idea, make a top level observability/ dir and put global tags styles (facets) in there
export interface ContextTags {
  edge?: string
  base_asset?: string // depricate in favour of some kind of context object?
  quote_asset?: string // depricate in favour of some kind of context object?
  class?: string // name of the class calling send_message
  exchange_type?: ExchangeType
  exchange?: "binance" | string
  symbol?: string
  unhandledRejection?: boolean // set on exceptions
  order_id?: string
  level?: "warn" | "error" | "debug" | "info" | "fatal"
}
