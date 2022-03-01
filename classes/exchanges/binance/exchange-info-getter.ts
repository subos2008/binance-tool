import { Binance, ExchangeInfo } from "binance-api-node"

export class BinanceExchangeInfoGetter {
  private ee: Binance
  private exchange_info_promise: Promise<ExchangeInfo> | null | undefined

  constructor({ ee }: { ee: Binance }) {
    this.ee = ee
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    if (this.exchange_info_promise) {
      return this.exchange_info_promise
    }

    console.warn(`exchange_info not cached, reloading`)

    if (!this.exchange_info_promise) {
      setTimeout(() => {
        this.exchange_info_promise = null
      }, 10 * 60 * 1000).unref()
    }

    this.exchange_info_promise = this.ee.exchangeInfo()
    return this.exchange_info_promise
  }
}
