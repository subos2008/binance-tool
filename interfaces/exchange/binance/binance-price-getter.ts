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

  constructor({ ee }: { ee: Binance }) {
    this.ee = ee
  }

  async get_current_price({ market_symbol }: { market_symbol: string }): Promise<BigNumber> {
    if (!this.prices) {
      this.prices = await this.ee.prices()
      let timer : NodeJS.Timeout = setTimeout(() => {
        this.prices = null
      }, 60 * 1000)
      timer.unref()
    }
    return new BigNumber(this.prices[market_symbol])
  }
}
