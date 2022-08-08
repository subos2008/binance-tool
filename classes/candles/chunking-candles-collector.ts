import { CandleChartResult } from "binance-api-node"
import { DateTime, Duration } from "luxon"
import { CandlesCollector } from "./interfaces"

export class ChunkingCandlesCollector implements CandlesCollector {
  candles_collector: CandlesCollector

  constructor({ candles_collector }: { candles_collector: CandlesCollector }) {
    this.candles_collector = candles_collector
    console.warn(`ChunkingCandlesCollector not tested`)
  }

  /**
   *  we can get 500 candles at a time from Binance
   *
   * to get more we need to make multiple requests
   *
   * if start_date + ~500 < end_date , then chunk
   *  */

  /***
   * Needs test, I think a good test is no duplicate candles and no missing ones (all consecutive)
   * start and end date logic should be the same
   */

  async get_candles_between({
    symbol,
    start_date,
    end_date,
    timeframe,
  }: {
    symbol: string
    start_date: Date
    end_date?: Date
    timeframe: "1d"
  }): Promise<CandleChartResult[]> {
    let start = DateTime.fromJSDate(start_date)
    let end = end_date ? DateTime.fromJSDate(end_date) : DateTime.now()

    let days = end.diff(start, "days").toObject().days
    if (!days) throw new Error(`days not defined in candles math`)
    if (days > 490) {
      // something close but not too close to 500
      let chunk = Duration.fromObject({ days: 489 }) // something close but not too close to 500
      let mid_date = start.plus(chunk).toJSDate()
      let a: CandleChartResult[] = await this.get_candles_between({
        symbol,
        start_date,
        end_date: mid_date,
        timeframe,
      })
      let b: CandleChartResult[] = await this.get_candles_between({
        symbol,
        start_date: mid_date,
        end_date,
        timeframe,
      })
      let candles = a.concat(b)
      return candles
    } else {
      /* forward */
      let candles = await this.candles_collector.get_candles_between({
        symbol,
        start_date,
        end_date,
        timeframe,
      })

      return candles
    }
  }
}
