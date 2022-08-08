import { CandleChartResult } from "binance-api-node"
import { BinanceCandlesCollector } from "./candle_utils"
import * as fs from "fs"
import { CandlesCollector } from "./interfaces"

export class CachingCandlesCollector implements CandlesCollector {
  candles_collector: BinanceCandlesCollector
  cache_path: string = `./candles-cache` // no slash

  constructor({ candles_collector }: { candles_collector: BinanceCandlesCollector }) {
    this.candles_collector = candles_collector
  }

  async get_candles_between({
    symbol,
    start_date,
    end_date,
    timeframe,
  }: {
    symbol: string
    start_date: Date
    end_date?: Date
    timeframe: "1w" | "1d"
  }): Promise<CandleChartResult[]> {
    let slug = `${symbol}-${timeframe}-${start_date}-${end_date}`
    let filename = `${this.cache_path}/candles-${slug}.json`

    if (fs.existsSync(filename)) {
      let buffer: Buffer = fs.readFileSync(filename)
      let json = buffer.toString()
      let object = JSON.parse(json)
      return object
    }

    let candles = await this.candles_collector.get_candles_between({
      symbol,
      start_date,
      end_date,
      timeframe,
    })

    let json = JSON.stringify(candles)
    fs.writeFileSync(filename, json)

    return candles
  }
}
