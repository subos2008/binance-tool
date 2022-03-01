/**
 * When a service that uses partial candles to detect breakouts restarts
 * it's possible it restarts when the breakout has already happened
 *
 * To prevent entering mid-trend during a rapidly moving market
 * we only allow signals if the first candle we see _isn't_ a trigger
 * candle.
 *
 * Once we see a daily close this logic shuts down
 */

export class TriggerMidTrendOnRestartPrevention {
  private symbol_to_triggering_allowed_map: { [symbol: string]: boolean } = {}
  private daily_close_seen: boolean = false

  process_new_daily_close_candle() {
    this.daily_close_seen = true
  }

  signal_allowed_on_symbol(symbol: string): boolean {
    if (this.daily_close_seen) {
      return true // we know we aren't mid-trend once we've seen a daily close
    }

    // Check if we have seen a value inside the bollenger bands since startup
    // We want to avoid the situation where the service starts when the price is already
    // outside the bands and we either 1) trigger immediately, 2) retrace and trigger
    // but if we set this to false we want to
    if (!(symbol in this.symbol_to_triggering_allowed_map)) {
      throw new Error(`Asked if we could signal on ${symbol} before initilisation`)
    }

    return this.symbol_to_triggering_allowed_map[symbol]
  }

  process_symbol({
    symbol,
    signal_high,
    signal_low,
  }: {
    symbol: string
    signal_high: boolean
    signal_low: boolean
  }) {
    if (this.daily_close_seen) {
      return // we know we aren't mid-trend once we've seen a daily close
    }

    if (symbol in this.symbol_to_triggering_allowed_map) {
      return // once the value is set we don't change it, we just wait for daily close
    }

    if (signal_high || signal_low) {
      this.symbol_to_triggering_allowed_map[symbol] = false // triggered already when first seen, disable signals until close candle
    }

    // if we got here we are seeing a symbol for the first time inside the bands
    this.symbol_to_triggering_allowed_map[symbol] = true
  }
}
