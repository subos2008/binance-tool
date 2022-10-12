import { Direction } from "./direction-persistance"

export interface MarketDirection {
  edge: string
  exchange: string
  exchange_type: string
  base_asset: string
  quote_asset: string
  previous_direction: Direction | "(null)"
  direction: Direction
  changed_direction: string // no bools allowed
  changed_to_long: string // no bools allowed
  changed_to_short: string // no bools allowed
}
