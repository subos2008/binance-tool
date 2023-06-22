import { strict as assert } from "assert"

// AGI has been delisted but is still set as tradeable
let base_assets_to_ignore = ["AGI"]

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Balance, Balance_with_quote_value, Portfolio, Prices } from "../../interfaces/portfolio"
import { AssetBalance, Binance as BinanceType, ExchangeInfo } from "binance-api-node"
import Binance from "binance-api-node"
import { Symbol } from "binance-api-node"
import { ServiceLogger } from "../../interfaces/logger"
import { BinanceExchangeInfoGetter } from "../exchanges/binance/exchange-info-getter"
import { TooSmallToTrade } from "../../interfaces/exchanges/generic/too_small_to_trade"
import { BinanceAlgoUtils } from "../../services/binance/spot/trade-abstraction-v2/execution/execution_engines/_internal/binance_algo_utils_v2"

export class PortfolioSnapshot {
  logger: ServiceLogger
  ee: BinanceType
  balances: AssetBalance[] | undefined
  exchange_info_getter: BinanceExchangeInfoGetter
  too_small_to_trade: TooSmallToTrade

  constructor({
    logger,
    exchange_info_getter,
  }: {
    logger: ServiceLogger
    exchange_info_getter: BinanceExchangeInfoGetter
  }) {
    assert(logger)
    this.logger = logger
    this.exchange_info_getter = exchange_info_getter

    logger.info("Live monitoring mode")
    if (!process.env.BINANCE_API_KEY) throw new Error(`Missing BINANCE_API_KEY in ENV`)
    if (!process.env.BINANCE_API_SECRET) throw new Error(`Missing BINANCE_API_SECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })
    this.too_small_to_trade = new BinanceAlgoUtils({ logger, ee: this.ee, exchange_info_getter })
  }

  /**
   *
   * @param param0 prices: if present we will not return any assets where the holding is below MIN_NOTIONAL, i.e. too small to trade
   * @returns
   */
  async take_snapshot({ prices }: { prices?: Prices } = {}): Promise<Balance[]> {
    let exchange_info: ExchangeInfo = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols.filter((s) => s.isSpotTradingAllowed)
    let asset_exists_in_exchange_info = (base_asset: string): boolean => {
      return symbols.find((s) => s.baseAsset == base_asset) ? true : false
    }

    async function findAsyncSequential<T>(
      array: T[],
      predicate: (t: T) => Promise<boolean>
    ): Promise<T | undefined> {
      for (const t of array) {
        if (await predicate(t)) {
          return t
        }
      }
      return undefined
    }

    let has_markets_where_balance_is_large_enough_to_trade = async (balance: AssetBalance): Promise<boolean> => {
      if (!prices) return true
      let markets_for_base_asset = symbols.filter((s) => s.baseAsset == balance.asset)

      let is_market_tradeable = async (market: Symbol) => {
        return !(await this.too_small_to_trade.is_too_small_to_trade({
          price: new BigNumber(prices[market.symbol]),
          volume: new BigNumber(balance.free).plus(balance.locked),
          symbol: market.symbol,
          exchange_info_getter: this.exchange_info_getter
        }))
      }
      // If there is at least one pair for this base_asset that's tradeable then return true
      let market = await findAsyncSequential(markets_for_base_asset, is_market_tradeable)
      return market ? true : false
    }

    let response = await this.ee.accountInfo()
    let balances = response.balances
    balances = balances.filter((b) => asset_exists_in_exchange_info(b.asset))
    balances = balances.filter((b) => !base_assets_to_ignore.includes(b.asset))
    if (prices) balances = balances.filter((b) => has_markets_where_balance_is_large_enough_to_trade(b))
    this.balances = balances
    return this.balances
  }

  async with_quote_value(args: { quote_asset: string; prices: Prices }): Promise<Balance_with_quote_value[]> {
    if (!this.balances) return []

    let { quote_asset } = args
    let balances_with_quote_value: Balance_with_quote_value[] = []
    for (const p of this.balances) {
      let base_asset = p.asset
      let tags = { base_asset, quote_asset }
      let position_size = new BigNumber(p.free).plus(p.locked)
      let quote_value: BigNumber | undefined
      if (position_size.isZero()) {
        quote_value = new BigNumber(0)
      } else {
        try {
          let symbol = await this.exchange_info_getter.to_symbol({ base_asset, quote_asset })
          if (!symbol) throw new Error(`No symbol for ${base_asset}:${quote_asset}`)
          let current_price = args.prices[symbol]
          quote_value = new BigNumber(current_price).times(position_size)
        } catch (err) {
          this.logger.exception(tags, err)
          this.logger.error(tags, `Unable to determine quote amount in ${quote_asset} for ${base_asset}`)
        }
      }
      balances_with_quote_value.push({
        ...p,
        total_quote_asset_value: quote_value,
        asset: base_asset,
        quote_asset,
      })
    }

    return balances_with_quote_value
  }
}
