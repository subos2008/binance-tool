import { Binance } from "binance-api-node"
import { CurrentPriceGetter } from "../generic/price-getter"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class BinancePriceGetter implements CurrentPriceGetter {
  ee: Binance
  prices: { [symbol: string]: string } | null = null
  cache_timeout_ms: number

  constructor({ ee, cache_timeout_ms }: { ee: Binance; cache_timeout_ms?: number }) {
    this.ee = ee
    this.cache_timeout_ms = cache_timeout_ms || 60 * 1000
  }

  async get_current_price({ market_symbol }: { market_symbol: string }): Promise<BigNumber> {
    if (!this.prices) {
      this.prices = await this.ee.prices()
      let timer: NodeJS.Timeout = setTimeout(() => {
        this.prices = null
      }, this.cache_timeout_ms)
      timer.unref()
    }
    return new BigNumber(this.prices[market_symbol])
  }
}
