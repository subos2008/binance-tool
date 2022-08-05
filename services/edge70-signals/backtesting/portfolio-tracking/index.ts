import Sentry from "../../../../lib/sentry"

// Prevent type coercion
import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Edge70SignalCallbacks, EdgeCandle } from "../../interfaces/_internal"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { Edge70BacktestParameters, Edge70Parameters, Edge70Signal } from "../../interfaces/edge70-signal"
import { DateTime } from "luxon"
import { Logger } from "../../../../lib/faux_logger"
import { PositionSizer } from "../../../../interfaces/position-sizer"
import { BacktesterSpotPostionsTracker } from "./positions-tracker"
import { ContextTags, SendMessageFunc } from "../../../../interfaces/send-message"
import { RedisClient } from "redis-mock"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { RedisSpotPositionsPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { GenericOrderData } from "../../../../types/exchange_neutral/generic_order_data"
import { MarketIdentifier_V5_with_base_asset } from "../../../../events/shared/market-identifier"

/* convert Edge70Signals to Orders and throw them to PositionsTracker - with mock_redis */

export class BacktestPortfolioTracker implements Edge70SignalCallbacks {
  logger: Logger
  edge: "edge70" | "edge70-backtest"
  health_and_readiness: HealthAndReadiness
  position_sizer: PositionSizer
  positions_tracker: BacktesterSpotPostionsTracker
  exchange_identifier: ExchangeIdentifier_V3
  quote_asset: string
  stops: { [base_asset: string]: BigNumber }
  stop_factor: BigNumber

  constructor({
    logger,
    edge,
    health_and_readiness,
    position_sizer,
    redis,
    exchange_identifier,
    quote_asset,
    edge70_parameters,
  }: {
    logger: Logger
    edge: "edge70" | "edge70-backtest"
    health_and_readiness: HealthAndReadiness
    edge70_parameters: Edge70BacktestParameters
    position_sizer: PositionSizer
    redis: RedisClient
    exchange_identifier: ExchangeIdentifier_V3
    quote_asset: string
  }) {
    this.logger = logger
    this.edge = edge
    this.health_and_readiness = health_and_readiness
    this.position_sizer = position_sizer
    this.exchange_identifier = exchange_identifier
    this.quote_asset = quote_asset
    this.stops = {}
    this.stop_factor = new BigNumber(edge70_parameters.stop_factor)
    const send_message: SendMessageFunc = async (msg: string, tags?: ContextTags) => {
      if (tags) logger.warn(tags, msg)
      else logger.warn(msg)
    }
    let positions_persistance = new RedisSpotPositionsPersistance({ logger, redis })
    let spot_positions_query = new SpotPositionsQuery({
      logger,
      positions_persistance,
      send_message,
      exchange_identifier,
    })
    this.positions_tracker = new BacktesterSpotPostionsTracker({
      send_message,
      logger,
      redis,
      spot_positions_query,
      spot_positions_persistance: positions_persistance,
      health_and_readiness,
    })
  }

  async init(): Promise<void> {}

  async publish(signal: Edge70Signal): Promise<void> {
    let { direction, market_identifier } = signal
    let { base_asset, symbol } = signal.market_identifier
    let { edge } = this
    let tags = { edge, base_asset, direction, symbol }
    let { signal_timestamp_ms, signal_price } = signal.signal

    let date = DateTime.fromMillis(signal_timestamp_ms).toFormat("yyyy LLL dd")
    this.logger.info(tags, `${date}: ${base_asset} ${direction.toUpperCase()}`)

    switch (direction) {
      case "long":
        if (!(await this.positions_tracker.in_position({ edge, base_asset }))) {
          await this.execute_buy({ signal_timestamp_ms, signal_price, market_identifier })
          this.add_stop({ market_identifier, signal_price })
        }
        break
      case "short":
        if (await this.positions_tracker.in_position({ edge, base_asset })) {
          let base_amount = await this.positions_tracker.position_size({ edge, base_asset })
          await this.execute_sell({ signal_timestamp_ms, signal_price, market_identifier, base_amount })
        }
        break
      default:
        throw new Error(`Unknown direction`)
    }
  }

  private async execute_buy(args: {
    signal_timestamp_ms: number
    signal_price: string
    market_identifier: MarketIdentifier_V5_with_base_asset
  }) {
    let { edge, exchange_identifier, quote_asset } = this
    let { market_identifier, signal_timestamp_ms, signal_price } = args
    let { symbol, base_asset } = market_identifier

    let order_id = `${symbol}-BUY-${signal_timestamp_ms}`
    let totalQuoteTradeQuantity = (
      await this.position_sizer.position_size_in_quote_asset({
        base_asset,
        quote_asset,
        edge,
        direction: "long",
      })
    ).toFixed()
    let totalBaseTradeQuantity = new BigNumber(totalQuoteTradeQuantity).dividedBy(signal_price).toFixed()
    let generic_order_data: GenericOrderData = {
      exchange_identifier,
      market_symbol: symbol,
      side: "BUY",
      baseAsset: base_asset,
      quoteAsset: quote_asset,
      orderType: "MARKET",
      orderTime: signal_timestamp_ms,
      averageExecutionPrice: signal_price,
      order_id,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
    }
    await this.positions_tracker.buy_order_filled({ generic_order_data })
  }

  private async execute_sell(args: {
    signal_timestamp_ms: number
    signal_price: string
    market_identifier: MarketIdentifier_V5_with_base_asset
    base_amount: BigNumber
  }) {
    let { exchange_identifier, quote_asset } = this
    let { market_identifier, signal_timestamp_ms, signal_price } = args
    let { symbol, base_asset } = market_identifier

    let totalBaseTradeQuantity = args.base_amount.toFixed()
    let totalQuoteTradeQuantity = args.base_amount.times(signal_price).toFixed()
    let order_id = `${symbol}-SELL-${signal_timestamp_ms}`
    let generic_order_data: GenericOrderData = {
      exchange_identifier,
      market_symbol: symbol,
      side: "SELL",
      baseAsset: base_asset,
      quoteAsset: quote_asset,
      orderType: "MARKET",
      orderTime: signal_timestamp_ms,
      averageExecutionPrice: signal_price,
      order_id,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
    }
    await this.positions_tracker.sell_order_filled({ generic_order_data })
    this.add_stop({ market_identifier, signal_price })
  }

  add_stop({
    market_identifier,
    signal_price,
  }: {
    market_identifier: MarketIdentifier_V5_with_base_asset
    signal_price: string
  }) {
    let { base_asset } = market_identifier
    this.stops[base_asset] = new BigNumber(signal_price).times(this.stop_factor)
  }

  /* check for stops */
  async ingest_new_candle({
    candle,
    market_identifier,
  }: {
    market_identifier: MarketIdentifier_V5_with_base_asset
    candle: EdgeCandle
  }): Promise<void> {
    let { edge } = this
    let { base_asset } = market_identifier
    if (await this.positions_tracker.in_position({ edge, base_asset })) {
      let stop_price = this.stops[base_asset]
      if (new BigNumber(candle.low).isLessThanOrEqualTo(stop_price)) {
        let signal_timestamp_ms = candle.closeTime
        let signal_price = stop_price.toFixed()
        this.logger.info(`HIT STOP ${base_asset} at price ${stop_price.toFixed()}`)
        let base_amount = await this.positions_tracker.position_size({ edge, base_asset })
        await this.execute_sell({ signal_timestamp_ms, signal_price, market_identifier, base_amount })
        delete this.stops[base_asset]
      }
    }
  }

  async summary() {
    await this.positions_tracker.summary()
  }
}
