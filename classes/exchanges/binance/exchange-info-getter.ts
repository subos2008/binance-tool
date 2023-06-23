import { Binance, ExchangeInfo, FuturesOrderType_LT } from "binance-api-node"
import { ExchangeIdentifier_V4 } from "../../../events/shared/exchange-identifier"
import { ExchangeInfoGetter } from "../../../interfaces/exchanges/binance/exchange-info-getter"
import { BunyanServiceLogger } from "../../../lib/service-logger"

const logger = new BunyanServiceLogger({ silent: false })

export class BinanceExchangeInfoGetter implements ExchangeInfoGetter {
  private ee: Binance
  private exchange_info_promise: Promise<ExchangeInfo> | null | undefined
  private minutes_to_cache_expiry: number = 24 * 60
  private emergency_cache: ExchangeInfo | undefined

  constructor({ ee, minutes_to_cache_expiry }: { ee: Binance; minutes_to_cache_expiry?: number }) {
    this.ee = ee
    if (minutes_to_cache_expiry) this.minutes_to_cache_expiry = minutes_to_cache_expiry
  }

  get_exchange_identifier(): ExchangeIdentifier_V4 {
    return { version: 4, exchange: "binance", exchange_type: "spot" }
  }

  async to_symbol(args: { base_asset: string; quote_asset: string }): Promise<string | undefined> {
    let exchange_info: ExchangeInfo = await this.get_exchange_info()
    let symbol = exchange_info.symbols.find(
      (s) => s.baseAsset === args.base_asset && s.quoteAsset == args.quote_asset
    )
    return symbol?.symbol
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    if (this.exchange_info_promise) {
      return this.exchange_info_promise
    }

    logger.event(
      { exchange: "binance", exchange_type: "spot" },
      {
        object_type: "BinanceExchangeInfoCacheMiss",
        object_class: "event",
        msg: `exchange_info not cached, reloading`,
      }
    )

    try {
      this.exchange_info_promise = this.ee.exchangeInfo()

      /* Keep maintianing a backup in case of 429's
       * Exceptions on this call probably are best avoided (unexpected in old code)
       */
      this.exchange_info_promise
        .then((value) => (this.emergency_cache = value))
        .catch((err) => logger.exception({}, err))

      setTimeout(() => {
        this.exchange_info_promise = null
      }, this.minutes_to_cache_expiry * 60 * 1000).unref()

      return this.exchange_info_promise
    } catch (err) {
      logger.exception({}, err)
      // shit, exception, return cached if we can
      if (this.emergency_cache) {
        logger.warn(`Failed getting exchangeInfo from Binance, using emergency cache`)
        return this.emergency_cache
      } else {
        logger.warn(`Failed getting exchangeInfo from Binance, no emergency cache, re-throwing`)
        throw err
      }
    }
  }
}

export class BinanceFuturesExchangeInfoGetter {
  private ee: Binance
  private exchange_info_promise: Promise<ExchangeInfo<FuturesOrderType_LT>> | null | undefined
  private minutes_to_cache_expiry: number = 24 * 60
  private emergency_cache: ExchangeInfo<FuturesOrderType_LT> | undefined

  constructor({ ee, minutes_to_cache_expiry }: { ee: Binance; minutes_to_cache_expiry?: number }) {
    this.ee = ee
    if (minutes_to_cache_expiry) this.minutes_to_cache_expiry = minutes_to_cache_expiry
  }

  async get_exchange_info(): Promise<ExchangeInfo<FuturesOrderType_LT>> {
    if (this.exchange_info_promise) {
      return this.exchange_info_promise
    }

    logger.event(
      { exchange: "binance", exchange_type: "futures" },
      {
        object_type: "BinanceFuturesExchangeInfoCacheMiss",
        object_class: "event",
        msg: `exchange_info not cached, reloading`,
      }
    )

    try {
      this.exchange_info_promise = this.ee.futuresExchangeInfo()

      /* Keep maintianing a backup in case of 429's
       * Exceptions on this call probably are best avoided (unexpected in old code)
       */
      this.exchange_info_promise
        .then((value) => (this.emergency_cache = value))
        .catch((err) => logger.exception({}, err))

      setTimeout(() => {
        this.exchange_info_promise = null
      }, this.minutes_to_cache_expiry * 60 * 1000).unref()

      return this.exchange_info_promise
    } catch (err) {
      logger.exception({}, err)
      // shit, exception, return cached if we can
      if (this.emergency_cache) {
        logger.warn(`Failed getting exchangeInfo from Binance, using emergency cache`)
        return this.emergency_cache
      } else {
        logger.warn(`Failed getting exchangeInfo from Binance, no emergency cache, re-throwing`)
        throw err
      }
    }
  }
}
