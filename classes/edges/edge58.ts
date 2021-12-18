import { Candle, CandleChartResult } from "binance-api-node"
import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { LimitedLengthCandlesHistory } from "../../classes/utils/candle_utils"
import { Edge58Parameters } from "../../events/shared/edge58-position-entry"

export interface Edge58EntrySignalsCallbacks {
  // We might have different filters on enter position or add to position
  // Maybe we should add the entry candle info here too
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void
}

export class Edge58EntrySignals {
  symbol: string
  logger: Logger

  callbacks: Edge58EntrySignalsCallbacks
  price_history_candles: LimitedLengthCandlesHistory
  edge58_parameters: Edge58Parameters

  constructor({
    logger,
    initial_candles,
    symbol,
    callbacks,
    edge58_parameters,
  }: {
    logger: Logger
    initial_candles: CandleChartResult[]
    symbol: string
    callbacks: Edge58EntrySignalsCallbacks
    edge58_parameters: Edge58Parameters
  }) {
    this.symbol = symbol
    this.logger = logger
    this.callbacks = callbacks
    this.edge58_parameters = edge58_parameters

    // Edge config - hardcoded as this should be static to the edge - short entry code expects close
    this.price_history_candles = new LimitedLengthCandlesHistory({
      length: edge58_parameters.candles_of_price_history,
      initial_candles,
      key: "close",
    })
  }

  async ingest_new_candle({
    timeframe,
    candle,
    symbol,
  }: {
    timeframe: string
    symbol: string
    candle: CandleChartResult | Candle
  }) {
    if (timeframe !== this.edge58_parameters.candle_timeframe) {
      console.log(`Short timeframe ${timeframe} candle on ${this.symbol} closed at ${candle.close}`)
      throw new Error(`Got a short timeframe candle`)
    }

    try {
      let potential_entry_price = new BigNumber(candle["close"])

      // check for long entry
      let highest_price = this.price_history_candles.get_highest_value()
      if (potential_entry_price.isGreaterThan(highest_price)) {
        let direction: "long" = "long"
        console.log(
          `Price entry signal on ${symbol} ${direction} at ${potential_entry_price.toFixed()}, ${new Date(
            candle.closeTime
          )}: current candle ${"close"} at ${potential_entry_price.toFixed()} greater than ${highest_price.toFixed()}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }

      // check for short entry
      let lowest_price = this.price_history_candles.get_lowest_value()
      if (potential_entry_price.isLessThan(lowest_price)) {
        let direction: "short" = "short"
        console.log(
          `Price entry signal ${direction} at ${potential_entry_price.toFixed()}, ${new Date(
            candle.closeTime
          )}: current candle ${"close"} at ${potential_entry_price.toFixed()} less than ${lowest_price.toFixed()}`
        )
        this.callbacks.enter_position({
          symbol: this.symbol,
          entry_price: potential_entry_price,
          direction,
        })
      }
    } catch (e) {
      this.logger.error(`Exception checking or entering position: ${e}`)
      console.error(e)
    } finally {
      // important not to miss this - lest we corrupt the history
      this.price_history_candles.push(candle)
    }
  }
}
