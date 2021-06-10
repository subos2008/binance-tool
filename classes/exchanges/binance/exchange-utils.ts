/* Exchange Neutral interface for operations on a given market
 * Where a market is a tradeable asset on an exchange - something you can create orders on and have positions in
 */

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Binance as BinanceType, Order, OcoOrder } from "binance-api-node"
import Binance from "binance-api-node"
import { ExchangeIdentifier } from "../../../events/shared/exchange-identifier"
import { ExchangeUtils } from "../../../interfaces/exchange/generic/exchange-utils"
import { Logger } from "../../../interfaces/logger"
import { AlgoUtils } from "../../../service_lib/binance_algo_utils_v2"

export class BinanceExchangeUtils implements ExchangeUtils {
  ee: BinanceType
  logger: Logger
  algo_utils: AlgoUtils
  exchange_identifier: ExchangeIdentifier
  _base_asset: string
  _quote_asset: string
  _exchange_info: any

  constructor({ logger, exchange_identifier }: { logger: Logger; exchange_identifier: ExchangeIdentifier }) {
    this.logger = logger
    this.exchange_identifier = exchange_identifier
    if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
    if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
    logger.warn(`ee derived from env vars and not ExchangeIdentifier`)
    this.ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    this.algo_utils = new AlgoUtils({ logger: this.logger, ee: this.ee })
  }

  async exchange_info() {
    if (this._exchange_info) return this._exchange_info
    else {
      // TODO: expiration
      return (this._exchange_info = await this.ee.exchangeInfo())
    }
  }

  get_prices(): Promise<{ [market_symbol: string]: string }> {
    return this.ee.prices()
  }
}
