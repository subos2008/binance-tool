import { CandleChartResult } from "binance-api-node"

export interface CandlesCollector {
  get_candles_between({
    symbol,
    start_date,
    end_date,
    timeframe,
  }: {
    symbol: string
    start_date: Date
    end_date?: Date
    timeframe: "1w" | "1d"
  }): Promise<CandleChartResult[]>
}
