import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { DateTime } from "luxon"
import { Edge61PositionEntrySignal } from "../../events/shared/edge61-position-entry"
import { Logger } from "../../interfaces/logger"

export class SignalSupression {
  logger: Logger
  max_allowed_message_age_ms: number = 1000
  max_trigger_to_signal_price_slippage_percentage: BigNumber = new BigNumber("0.3")

  constructor(args: { logger: Logger }) {
    this.logger = args.logger
  }
  signal_allowed(signal: Edge61PositionEntrySignal): boolean {
    let allowed = true

    allowed = allowed && !this.time_of_day_supression(signal)
    allowed = allowed && !this.old_messages_supression(signal)
    allowed = allowed && !this.trigger_to_signal_price_slippage_supression(signal)

    return allowed
  }

  private time_of_day_supression(signal: Edge61PositionEntrySignal): boolean {
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
      this.logger.object({
        object_type: "SignalSupression",
        signal_time,
        edge,
        base_asset,
        reason: "time_of_day_supression",
      })
    }
    return suppressed
  }

  private old_messages_supression(signal: Edge61PositionEntrySignal): boolean {
    /* We suppress entries on this signal when the singal is older than a few seconds */
    let signal_time = DateTime.fromMillis(signal.edge61_entry_signal.signal_timestamp_ms).toUTC()
    let now = DateTime.now()
    let message_age = now.minus(signal_time)

    let suppressed = false
    if (message_age.toMillis() > this.max_allowed_message_age_ms) {
      suppressed = true
    }

    if (suppressed) {
      let { edge } = signal
      let { base_asset } = signal.market_identifier
      this.logger.object({
        object_type: "SignalSupression",
        signal_time,
        edge,
        base_asset,
        reason: "old_message",
        max_allowed_message_age_ms: this.max_allowed_message_age_ms,
        message_age,
      })
    }
    return suppressed
  }

  trigger_to_signal_price_slippage_supression(signal: Edge61PositionEntrySignal): boolean {
    /**
     * Suppress any signals where the trigger to signal price slippage is significant
     *
     * This often happens at the daily close when the bollenger bands move, these aren't
     * the kind of signals we are looking for - we want the price to cross the bands and not
     * visa versa
     *
     * */

    let signal_price = new BigNumber(signal.edge61_entry_signal.signal_price)
    let trigger_price = signal.edge61_entry_signal.trigger_price
    let trigger_to_signal_slippage_pct = signal_price.minus(trigger_price).dividedBy(trigger_price).times(100)
    let abs_trigger_to_signal_slippage_pct = trigger_to_signal_slippage_pct.abs()

    let suppressed = false
    if (abs_trigger_to_signal_slippage_pct.isGreaterThan(this.max_trigger_to_signal_price_slippage_percentage)) {
      suppressed = true
    }

    if (suppressed) {
      let { edge } = signal
      let { base_asset } = signal.market_identifier
      this.logger.object({
        object_type: "SignalSupression",
        edge,
        base_asset,
        reason: "trigger_to_signal_price_slippage",
        abs_trigger_to_signal_slippage_pct,
        max_trigger_to_signal_price_slippage_percentage: this.max_trigger_to_signal_price_slippage_percentage,
        trigger_to_signal_slippage_pct,
      })
    }
    return suppressed
  }
}
