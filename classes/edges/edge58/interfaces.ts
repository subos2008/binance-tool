import { Edge58EntrySignal } from "../../../events/shared/edge58"


export interface Candle {
  open: string
  close: string
  closeTime: number // candle close timestamp
  low: string // wicks needed for stops
  high: string // wicks needed for stops
}

export interface Edge58EntrySignalsCallbacks {
  enter_or_add_to_position(event: Edge58EntrySignal): void
}
