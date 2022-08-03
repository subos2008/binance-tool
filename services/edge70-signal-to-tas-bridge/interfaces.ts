import { Edge70Signal } from "../edge70-signals/interfaces/edge70-signal";

export interface Edge70SignalProcessor {
  process_signal: (signal: Edge70Signal) => Promise<void>
}
