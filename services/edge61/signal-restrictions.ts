import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { IngestionCandle, StoredCandle } from "./interfaces"

export class SignalRestrictions {
  /**
   * the can_signal functions guard us from continual entry signals on every price
   * long or short of the donchien channel. We want to trigger once and then be silent
   */
  /** if current price is not beyond slippage price and the price since the last StorageCande update
   * didn't already pass the slippage price
   *
   * So the time of the last StorageCandle is an input
   * and probably the most recent candle comes in here too, not seperately
   */

  async ingest_candle() {
    /**
     * If first candle since launch it needs to be below the signal price or signals are invalidated
     * (via redis) until the next close time
     * If close candle: triggers are allowed again (but this is a nop since we don't cache this state - it's in redis)
     */
  }

  async signal_allowed(symbol: string, direction: "long" | "short") {
    /**
     * no if redis says no - because we already signalled once since the last candle close
     * no if we haven't seen any candles inside the donchen bands for that symbol since launch
     * .. no if in trade? .. (the one-signal-per candle should catch most of these - though some trades will stay open swing trading accross multiple candles)
     */
  }
}
