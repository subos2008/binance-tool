import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { CoinGeckoAPI, CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { MarketIdentifier_V5 } from "../../events/shared/market-identifier"
import humanNumber from "human-number"

/* config */
// num_coins_to_monitor: amount of market data to pull from CoinGekko
// When we signal on coins we have this data for we add it to signals
const num_coins_to_monitor = 300

export class MarketData {
  private _market_data: CoinGeckoMarketData[] | undefined

  async init() {
    let cg = new CoinGeckoAPI()
    // not all of these will be on Binance
    this._market_data = await cg.get_top_market_data({ limit: num_coins_to_monitor })
  }

  /* Event decorators */
  market_data(mi: MarketIdentifier_V5): CoinGeckoMarketData | undefined {
    if (!mi.base_asset) return
    if (!this._market_data) return
    let data = this._market_data.find((x) => x.symbol.toUpperCase() === mi.base_asset?.toUpperCase())
    return data
  }

  market_data_string(cgd: CoinGeckoMarketData): string | undefined {
    return `RANK: ${cgd.market_cap_rank}, MCAP: ${humanNumber(new BigNumber(cgd.market_cap).sd(2).toNumber())}`
  }
}
