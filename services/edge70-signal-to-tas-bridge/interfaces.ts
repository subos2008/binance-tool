import { Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"

export interface Edge60EntrySignalProcessor {
  process_edge60_entry_signal: (signal: Edge60PositionEntrySignal) => Promise<void>
}
