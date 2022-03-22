import { DateTime } from "luxon"
import { Edge61PositionEntrySignal } from "../../events/shared/edge61-position-entry"
import { Logger } from "../../interfaces/logger"

export class SignalSupression {
  logger: Logger
  constructor(args: { logger: Logger }) {
    this.logger = args.logger
  }
  signal_allowed(signal: Edge61PositionEntrySignal): boolean {
    /* We suppress entries on this signal between a bit before midnight and a bit after midnight */
    let signal_time = DateTime.fromMillis(signal.edge61_entry_signal.signal_timestamp_ms).toUTC()
    let suppressed: boolean = false
    /* end of UTC day supression */
    let start_of_supressed_period = signal_time.set({ hour: 23, minute: 59, second: 0, millisecond: 0 })
    if (signal_time >= start_of_supressed_period) suppressed = true
    /* start of UTC day supression */
    let end_of_supressed_period = signal_time.set({ hour: 0, minute: 5, second: 0, millisecond: 0 })
    if (signal_time <= end_of_supressed_period) suppressed = true

    if (suppressed) {
      let { edge } = signal
      let { base_asset } = signal.market_identifier
      this.logger.object({ object_type: "SignalSupression", signal_time, edge, base_asset })
    }
    return suppressed
  }
}
