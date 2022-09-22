import BigNumber from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { SendMessageFunc } from "../../interfaces/send-message"
import { ServiceLogger } from "../../interfaces/logger"
import { Binance } from "binance-api-node"
import { RedisClient } from "redis"
import { PositionsSnapshot } from "./lib/positions-snapshot"
import { SpotPositionsQuery } from "../../classes/spot/abstractions/spot-positions-query"
import {
  SpotPositionObject_V2,
  SpotPositionObject_V2_with_quote_value,
} from "../../classes/spot/abstractions/spot-position"
import { Balance, Balance_with_quote_value, Prices, SpotPortfolio } from "../../interfaces/portfolio"
import { PortfolioSnapshot } from "./lib/portfolio-snapshot"
import { BinancePriceGetter } from "../../interfaces/exchanges/binance/binance-price-getter"

export class PortfolioVsPositions {
  ee: Binance
  logger: ServiceLogger
  close_short_timeframe_candle_ws: (() => void) | undefined
  close_1d_candle_ws: (() => void) | undefined
  send_message: SendMessageFunc
  exchange_info_getter: BinanceExchangeInfoGetter
  health_and_readiness: HealthAndReadiness
  spot_positions_query: SpotPositionsQuery
  portfolio_snapshot: PortfolioSnapshot
  positions_snapshot: PositionsSnapshot
  quote_asset: string
  prices_getter: BinancePriceGetter

  constructor({
    ee,
    logger,
    send_message,
    health_and_readiness,
    spot_positions_query,
    redis,
    quote_asset,
    prices_getter,
  }: {
    ee: Binance
    logger: ServiceLogger
    send_message: SendMessageFunc
    health_and_readiness: HealthAndReadiness
    spot_positions_query: SpotPositionsQuery
    redis: RedisClient
    quote_asset: string
    prices_getter: BinancePriceGetter
  }) {
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.quote_asset = quote_asset
    this.send_message("service re-starting")
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
    this.health_and_readiness = health_and_readiness
    this.spot_positions_query = spot_positions_query
    this.prices_getter = prices_getter
    this.portfolio_snapshot = new PortfolioSnapshot({
      logger,
      redis,
      exchange_info_getter: this.exchange_info_getter,
    })
    this.positions_snapshot = new PositionsSnapshot({
      logger,
      spot_positions_query,
      exchange_info_getter: this.exchange_info_getter,
    })
  }

  async positions(): Promise<SpotPositionObject_V2[]> {
    return await this.positions_snapshot.take_snapshot()
  }

  async positions_with_quote_value(quote_asset: string): Promise<SpotPositionObject_V2_with_quote_value[]> {
    await this.positions_snapshot.take_snapshot()
    let prices: Prices = await this.prices_getter.get_current_prices()
    return this.positions_snapshot.get_positions_quote_values({ quote_asset, prices })
  }

  async portfolio(): Promise<Balance[]> {
    return await this.portfolio_snapshot.take_snapshot()
  }

  async portfolio_with_quote_value(quote_asset: string): Promise<Balance_with_quote_value[]> {
    await this.portfolio_snapshot.take_snapshot()
    let prices: Prices = await this.prices_getter.get_current_prices()
    return await this.portfolio_snapshot.with_quote_value({ quote_asset, prices })
  }

  async run_once(args: { quote_asset: string }) {
    let positions: SpotPositionObject_V2_with_quote_value[] = await this.positions_with_quote_value(
      args.quote_asset
    )

    /* Convert to expected amount of each base_asset (sum all open positions in that asset) */
    let base_assets_in_positions = new Set(positions.map((p) => p.base_asset))
    let expected_total_holdings_map: { [base_asset: string]: BigNumber } = {}
    for (const base_asset of base_assets_in_positions) {
      let p_list_for_base_asset: SpotPositionObject_V2_with_quote_value[] = positions.filter(
        (p) => p.base_asset === base_asset
      )
      expected_total_holdings_map[base_asset] = BigNumber.sum.apply(
        null,
        p_list_for_base_asset.map((p) => p.position_size)
      )
    }

    let balances: Balance_with_quote_value[] = await this.portfolio_with_quote_value(this.quote_asset)
    let portfolio_base_assets = new Set(balances.map((p) => p.asset))
    let actual_holdings_map: { [base_asset: string]: BigNumber } = {}
    for (const balance of balances) {
      actual_holdings_map[balance.asset] = new BigNumber(balance.free).plus(balance.locked)
    }

    /* Either we hold them or we expect to */
    let combined_base_assets = new Set([...portfolio_base_assets, ...base_assets_in_positions])

    let assets_where_we_hold_less_than_expected: string[] = []
    let assets_where_we_hold_more_than_expected: string[] = []
    for (const base_asset of combined_base_assets) {
      const actual_holdings = actual_holdings_map[base_asset] || new BigNumber(0)
      const expected_total_holdings = expected_total_holdings_map[base_asset] || new BigNumber(0)
      if (actual_holdings.isGreaterThan(expected_total_holdings)) {
        assets_where_we_hold_more_than_expected.push(base_asset)
      }

      if (expected_total_holdings.isGreaterThan(actual_holdings)) {
        assets_where_we_hold_less_than_expected.push(base_asset)
      }
    }

    for (const base_asset of assets_where_we_hold_more_than_expected) {
      let expected = expected_total_holdings_map[base_asset] || new BigNumber(0)
      let actual = actual_holdings_map[base_asset] || new BigNumber(0)
      this.send_message(
        `Problema: ${base_asset} balance higher than expected: expected ${expected} ${base_asset}, actual ${actual} ${base_asset}`
      )
    }

    for (const base_asset of assets_where_we_hold_less_than_expected) {
      let expected = expected_total_holdings_map[base_asset] || new BigNumber(0)
      let actual = actual_holdings_map[base_asset] || new BigNumber(0)

      if (actual.isZero()) {
        /* We can authoratively say a particular position doesn't exist if we hold zero */
        let missing_positions = positions.filter((p) => p.base_asset == base_asset)
        let msg =
          `Problema: Zero ${base_asset} held; the following positions have zero corresponding balance: ` +
          missing_positions.map((p) => `${p.edge}:${p.base_asset}`).join(", ")
        this.send_message(msg)
      } else {
        this.send_message(
          `Problema: ${base_asset} balance lower than expected: expected ${expected} ${base_asset}, actual ${actual} ${base_asset}`
        )
      }
    }
  }
}
