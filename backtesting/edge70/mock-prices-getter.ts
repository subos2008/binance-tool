import { BinanceStyleSpotPrices } from "../../classes/spot/abstractions/position-identifier"
import { CurrentAllPricesGetter } from "../../interfaces/exchanges/generic/price-getter"
import { CandlesMap } from "./portfolio-tracking/interfaces"

export class MockPricesGetter implements CurrentAllPricesGetter {
  _prices: BinanceStyleSpotPrices = {}

  async prices(): Promise<BinanceStyleSpotPrices> {
    return this._prices
  }

  set_prices_from_candles(candles_map:CandlesMap ) {
    this._prices = {}
    for (const symbol in candles_map) {
      this._prices[symbol] = candles_map[symbol].close
    }
  }
}
