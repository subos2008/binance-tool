import { Binance, ExchangeInfo } from "binance-api-node"
import { ExchangeIdentifier_V4 } from "../../../events/shared/exchange-identifier"

import { Logger } from "../../../lib/faux_logger"
const logger = new Logger({ silent: false })

export class BinanceExchangeInfoGetter {
  private ee: Binance
  private exchange_info_promise: Promise<ExchangeInfo> | null | undefined
  private minutes_to_cache_expiry: number = 24 * 60

  constructor({ ee, minutes_to_cache_expiry }: { ee: Binance; minutes_to_cache_expiry?: number }) {
    this.ee = ee
    if (minutes_to_cache_expiry) this.minutes_to_cache_expiry = minutes_to_cache_expiry
  }

  get_exchange_identifier(): ExchangeIdentifier_V4 {
    return { version: 4, exchange: "binance", exchange_type: "spot" }
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    if (this.exchange_info_promise) {
      return this.exchange_info_promise
    }

    logger.warn({ object_type: "BinanceExchangeInfoCacheMiss" }, `exchange_info not cached, reloading`)

    if (!this.exchange_info_promise) {
      setTimeout(() => {
        this.exchange_info_promise = null
      }, this.minutes_to_cache_expiry * 60 * 1000).unref()
    }

    this.exchange_info_promise = this.ee.exchangeInfo()
    return this.exchange_info_promise
  }
}

export class BinanceFuturesExchangeInfoGetter {
  private ee: Binance
  private exchange_info_promise: Promise<ExchangeInfo> | null | undefined
  private minutes_to_cache_expiry: number = 24 * 60

  constructor({ ee, minutes_to_cache_expiry }: { ee: Binance; minutes_to_cache_expiry?: number }) {
    this.ee = ee
    if (minutes_to_cache_expiry) this.minutes_to_cache_expiry = minutes_to_cache_expiry
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    if (this.exchange_info_promise) {
      return this.exchange_info_promise
    }

    logger.warn({ object_type: "BinanceFuturesExchangeInfoCacheMiss" }, `exchange_info not cached, reloading`)

    if (!this.exchange_info_promise) {
      setTimeout(() => {
        this.exchange_info_promise = null
      }, this.minutes_to_cache_expiry * 60 * 1000).unref()
    }

    this.exchange_info_promise = this.ee.futuresExchangeInfo()
    return this.exchange_info_promise
  }
}
