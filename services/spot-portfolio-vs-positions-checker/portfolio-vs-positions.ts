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
import { SpotPositionObject_V2 } from "../../classes/spot/abstractions/spot-position"
import { Balance, SpotPortfolio } from "../../interfaces/portfolio"
import { PortfolioSnapshot } from "./lib/portfolio-snapshot"

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

  constructor({
    ee,
    logger,
    send_message,
    health_and_readiness,
    spot_positions_query,
    redis,
  }: {
    ee: Binance
    logger: ServiceLogger
    send_message: SendMessageFunc
    health_and_readiness: HealthAndReadiness
    spot_positions_query: SpotPositionsQuery
    redis: RedisClient
  }) {
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting")
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
    this.health_and_readiness = health_and_readiness
    this.spot_positions_query = spot_positions_query
    this.portfolio_snapshot = new PortfolioSnapshot({ logger, redis })
    this.positions_snapshot = new PositionsSnapshot({
      logger,
      spot_positions_query,
    })
  }

  async positions(): Promise<SpotPositionObject_V2[]> {
    return await this.positions_snapshot.take_snapshot()
  }

  async portfolio(): Promise<Balance[]> {
    return await this.portfolio_snapshot.take_snapshot()
  }

  async run_once() {
    let positions: SpotPositionObject_V2[] = await this.positions()

    /* Convert to expected amount of each base_asset */
    let base_assets_in_positions = new Set(positions.map((p) => p.base_asset))
    let expected_total_holdings: { [base_asset: string]: BigNumber } = {}
    for (const base_asset of base_assets_in_positions) {
      let p_list_for_base_asset: SpotPositionObject_V2[] = positions.filter((p) => p.base_asset === base_asset)
      expected_total_holdings[base_asset] = BigNumber.sum.apply(
        null,
        p_list_for_base_asset.map((p) => p.position_size)
      )
    }

    let balances: Balance[] = await this.portfolio()
    let portfolio_base_assets = new Set(balances.map((p) => p.asset))
    let actual_holdings: { [base_asset: string]: BigNumber } = {}
    for (const balance of balances) {
      actual_holdings[balance.asset] = new BigNumber(balance.free).plus(balance.locked)
    }

    let combined_base_assets = new Set([...portfolio_base_assets, ...base_assets_in_positions])

    let net_expected: { [base_asset: string]: { base_amount: BigNumber } } = {}
    for (const base_asset of combined_base_assets) {
      /* check each direction and produce results... could be net amount +/- vs expected? */
      net_expected[base_asset] = {
        base_amount: expected_total_holdings[base_asset].minus(actual_holdings[base_asset]),
      }
    }
  }
}
