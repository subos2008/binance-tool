import { Binance, ExchangeInfo } from "binance-api-node"

export class BinanceExchangeInfoGetter {
  private ee: Binance
  private exchange_info: ExchangeInfo | null | undefined

  constructor({ ee }: { ee: Binance }) {
    this.ee = ee
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    if (!this.exchange_info) {
      this.exchange_info = await this.ee.exchangeInfo()
      setTimeout(() => {
        this.exchange_info = null
      },10 * 60 * 1000).unref()
    }
    return this.exchange_info
  }
}
