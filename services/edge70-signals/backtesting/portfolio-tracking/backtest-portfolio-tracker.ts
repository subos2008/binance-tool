import Sentry from "../../../../lib/sentry"

// Prevent type coercion
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { EdgeCandle } from "../../interfaces/_internal"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { Edge70BacktestParameters } from "../../interfaces/edge70-signal"
import { PositionSizer } from "../../../../interfaces/position-sizer"
import { BacktesterSpotPostionsTracker } from "./positions-tracker"
import { ContextTags, SendMessageFunc } from "../../../../interfaces/send-message"
import { RedisClient } from "redis-mock"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { RedisSpotPositionsPersistence } from "../../../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { MarketIdentifier_V5_with_base_asset } from "../../../../events/shared/market-identifier"
import { RedisOrderContextPersistence } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { ServiceLogger } from "../../../../interfaces/logger"
import { PositionsSnapshot } from "./positions-snapshot"
import { CurrentAllPricesGetter } from "../../../../interfaces/exchanges/generic/price-getter"
import { BacktestTradeExecution } from "./lib/backtest-trade-execution"
import { EdgeSignalsToTradeExecution } from "./lib/edge-signals-to-trade-execution"
import { BankOfBacktesting } from "./interfaces"
import { CaptainHooksBacktesterStats } from "./captain-hooks-backtester-stats"
import { PortfolioSummary } from "./portfolio-summary"
import { ExchangeInfoGetter } from "../../../../interfaces/exchanges/binance/exchange-info-getter"

/* convert Edge70Signals to Orders and throw them to PositionsTracker - with mock_redis */

export class BacktestPortfolioTracker {
  logger: ServiceLogger
  edge: "edge70" | "edge70-backtest"
  health_and_readiness: HealthAndReadiness
  position_sizer: PositionSizer
  exchange_identifier: ExchangeIdentifier_V3
  quote_asset: string
  stop_factor: BigNumber
  prices_getter: CurrentAllPricesGetter
  spot_positions_query: SpotPositionsQuery
  edge_signals_to_trade_execution: EdgeSignalsToTradeExecution
  trade_execution: BacktestTradeExecution
  captain_hooks_backtester_stats: CaptainHooksBacktesterStats[] = []
  exchange_info_getter: ExchangeInfoGetter
  bank: BankOfBacktesting

  constructor({
    logger,
    edge,
    health_and_readiness,
    position_sizer,
    redis,
    exchange_identifier,
    quote_asset,
    edge70_parameters,
    prices_getter,
    bank,
    exchange_info_getter,
  }: {
    logger: ServiceLogger
    edge: "edge70" | "edge70-backtest"
    health_and_readiness: HealthAndReadiness
    edge70_parameters: Edge70BacktestParameters
    position_sizer: PositionSizer
    redis: RedisClient
    exchange_identifier: ExchangeIdentifier_V3
    quote_asset: string
    prices_getter: CurrentAllPricesGetter
    bank: BankOfBacktesting
    exchange_info_getter: ExchangeInfoGetter
  }) {
    this.logger = logger
    this.edge = edge
    this.health_and_readiness = health_and_readiness
    this.position_sizer = position_sizer
    this.exchange_identifier = exchange_identifier
    this.quote_asset = quote_asset
    this.prices_getter = prices_getter
    this.exchange_info_getter = exchange_info_getter
    this.bank = bank
    this.stop_factor = new BigNumber(edge70_parameters.stop_factor)
    const send_message: SendMessageFunc = async (msg: string, tags?: ContextTags) => {
      if (tags) logger.warn(tags, msg)
      else logger.warn(msg)
    }
    let positions_persistance = new RedisSpotPositionsPersistence({ logger, redis })
    let order_context_persistence = new RedisOrderContextPersistence({ logger, redis })
    this.spot_positions_query = new SpotPositionsQuery({
      logger,
      positions_persistance,
      send_message,
      exchange_identifier,
    })
    let { spot_positions_query } = this
    let positions_tracker = new BacktesterSpotPostionsTracker({
      send_message,
      logger,
      redis,
      spot_positions_query,
      spot_positions_persistance: positions_persistance,
      health_and_readiness,
    })
    this.trade_execution = new BacktestTradeExecution({
      logger,
      edge,
      edge70_parameters,
      position_sizer,
      exchange_identifier,
      quote_asset,
      order_context_persistence,
      positions_tracker,
      bank,
      spot_positions_query,
    })
    let { trade_execution } = this

    this.edge_signals_to_trade_execution = new EdgeSignalsToTradeExecution({
      positions_tracker,
      logger,
      edge,
      trade_execution,
      spot_positions_query,
    })
  }

  get edge70_signals_callbacks() {
    return this.edge_signals_to_trade_execution
  }

  async init(): Promise<void> {
    await this.edge_signals_to_trade_execution.init()
    // initialise the stats engines before any candles are ingested
    await this.all_new_candles_ingested()
  }

  add_captain_hooks_backtester_stats(hooks: CaptainHooksBacktesterStats) {
    this.captain_hooks_backtester_stats.push(hooks)
  }

  /* check for stops */
  async ingest_new_candle({
    candle,
    market_identifier,
  }: {
    market_identifier: MarketIdentifier_V5_with_base_asset
    candle: EdgeCandle
  }): Promise<void> {
    return this.trade_execution.ingest_new_candle({
      candle,
      market_identifier,
    })
  }

  /* Called after ingest_new_candle has been called on all the new candles
   * Kinda means to run the end of day report
   */
  async all_new_candles_ingested() {
    let { logger, spot_positions_query, prices_getter, exchange_info_getter } = this
    let positions_snapshot = new PositionsSnapshot({
      logger,
      spot_positions_query,
      prices_getter,
      exchange_info_getter,
    })
    await positions_snapshot.take_snapshot()

    let { cash, loan } = this.bank.balances()
    let portfolio_summary = new PortfolioSummary({
      cash,
      loan,
      positions_snapshot,
      quote_asset: this.quote_asset,
    })
    for (const hooks of this.captain_hooks_backtester_stats) {
      await hooks.portfolio_summary_at_candle_close(portfolio_summary)
    }
  }

  async summary() {
    if (this.captain_hooks_backtester_stats.length === 0) {
      this.logger.error(`No Captain Hook's Stats modules loaded - no summery to display`)
      return
    }
    for (const hooks of this.captain_hooks_backtester_stats) {
      await hooks.summary()
    }
  }
}
