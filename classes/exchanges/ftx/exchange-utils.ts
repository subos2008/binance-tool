import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ExchangeUtils } from "../../../interfaces/exchange/generic/exchange-utils"
import { FtxMarket } from "./rest-client"

export class FtxExchangeUtils implements ExchangeUtils {
  markets: FtxMarket[]

  constructor({ markets }: { markets: FtxMarket[] }) {
    this.markets = markets
  }

  base_asset_for_market(symbol: string): string {
    let result = this.markets.find((m) => m.name === symbol)?.baseCurrency
    if (!result) throw new Error(`Unable to determine baseCurrency for market ${symbol} on FTX`)
    return result
  }

  quote_asset_for_market(symbol: string): string {
    let result = this.markets.find((m) => m.name === symbol)?.quoteCurrency
    if (!result) throw new Error(`Unable to determine quoteCurrency for market ${symbol} on FTX`)
    return result
  }

  // Return true if the exchange would return an error if we attempted to make an order this small
  is_too_small_to_trade({
    price,
    volume,
    market_symbol,
  }: {
    market_symbol: string
    price: BigNumber
    volume: BigNumber
  }): boolean {
    // return true
    throw new Error(`Not implemented`)
  }
}
