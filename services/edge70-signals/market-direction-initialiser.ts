import Sentry from "../../lib/sentry"
import { strict as assert } from "assert"

import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { BinanceCandlesCollector } from "../../classes/candles/candle_utils"
import { ContextTags, SendMessageFunc } from "../../interfaces/send-message"
import { DirectionPersistence } from "./interfaces/direction-persistance"
import { Edge70Parameters, Edge70Signal } from "./interfaces/edge70-signal"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { MarketIdentifier_V5_with_base_asset } from "../../events/shared/market-identifier"
import { DateTime } from "luxon"
import { Edge70Signals } from "./signals"
import { Edge70SignalCallbacks } from "./interfaces/_internal"
import { ServiceLogger } from "../../interfaces/logger"

// import { DirectionPersistenceRedis } from "./direction-persistance"
// var mock_redis = require("redis-mock"),
//   mock_redis_client = mock_redis.createClient()

export class MarketDirectionInitialiser implements Edge70SignalCallbacks {
  candles_collector: BinanceCandlesCollector
  logger: ServiceLogger
  direction_persistance: DirectionPersistence
  market_identifier: MarketIdentifier_V5_with_base_asset
  edge70_parameters: Edge70Parameters
  num_candles_history_to_check: number = 200 // something on a massive trend might not hit in 100

  constructor({
    logger,
    direction_persistance,
    candles_collector,
    edge70_parameters,
    market_identifier,
  }: {
    logger: ServiceLogger
    direction_persistance: DirectionPersistence
    candles_collector: BinanceCandlesCollector
    market_identifier: MarketIdentifier_V5_with_base_asset
    edge70_parameters: Edge70Parameters
  }) {
    this.candles_collector = candles_collector
    this.logger = logger
    this.direction_persistance = direction_persistance
    this.market_identifier = market_identifier
    this.edge70_parameters = edge70_parameters
  }

  async init(): Promise<void> {
    /* nop */
  }
  async publish(event: Edge70Signal) {
    /* actually, do nothing we are just letting the edge initialise the direction */
  }

  async run() {
    try {
      let { market_identifier, num_candles_history_to_check, edge70_parameters } = this
      let { symbol, base_asset } = market_identifier
      let tags = { symbol, base_asset }

      let end_date = DateTime.now()
      let candles_preload_start_date = end_date.minus({ days: num_candles_history_to_check })
      let candles = await this.candles_collector.get_candles_between({
        timeframe: this.edge70_parameters.candle_timeframe,
        symbol,
        start_date: candles_preload_start_date.toJSDate(),
        end_date: end_date.toJSDate(),
      })

      if (candles.length == 0) {
        this.logger.error(`No candles loaded for ${symbol}`)
        let err = new Error(`No candles loaded for ${symbol}`)
        Sentry.captureException(err) // this is unexpected now, 429?
        throw err
      } else {
        this.logger.info(`Loaded ${candles.length} candles for ${symbol}`)
      }

      // chop off the most recent candle as the code above gives us a partial candle at the end
      if (candles.length > 0 && candles[candles.length - 1].closeTime > Date.now()) {
        let partial_candle = candles.pop()
        if (partial_candle) assert(partial_candle.closeTime > Date.now()) // double check that was actually a partial candle
      }
      let num_loaded_candles = candles.length

      // let service-logger = this.logger
      // let faux_send_message: SendMessageFunc = async (msg: string, tags?: ContextTags) => {
      //   if (tags) this.logger.info(tags, msg)
      //   else this.logger.info(msg)
      // }
      let faux_logger: ServiceLogger = new BunyanServiceLogger({ silent: true })
      let faux_send_message: SendMessageFunc = async () => {
        return
      }

      // let prefix = `market-direction-initialiser:${symbol}:` + randomUUID()
      // let isolated_direction_persistance = new DirectionPersistenceRedis({
      //   prefix,
      //   logger: service-logger,
      //   redis: mock_redis_client,
      // })

      // We don't want this failing to kill the service
      let faux_health_and_readiness = new HealthAndReadiness({ logger: faux_logger }).addSubsystem({
        name: `FauxMarketDirectionH&R`,
        ready: true,
        healthy: true,
      })
      let edge = new Edge70Signals({
        logger: faux_logger,
        send_message: faux_send_message,
        health_and_readiness: faux_health_and_readiness,
        initial_candles: [],
        market_identifier,
        callbacks: this,
        direction_persistance: this.direction_persistance,
        // direction_persistance: isolated_direction_persistance,
        edge70_parameters,
      })

      this.logger.info(tags, `Sending candles for ${symbol}`)
      for (const candle of candles) {
        await edge.ingest_new_candle({ symbol, candle })
      }
      this.logger.info(tags, `MDI finished candles for ${symbol}`)

      let direction = await this.direction_persistance.get_direction(base_asset)
      // let direction = await isolated_direction_persistance.get_direction(base_asset)
      if (direction) {
        // await this.direction_persistance.set_direction(base_asset, direction)
        let event = {
          object_type: "MarketDirectionInitialiserResult",
          success: true,
          direction,
          symbol,
          base_asset,
          num_candles_history_to_check,
        }
        this.logger.event(tags, event)
      } else {
        this.logger.error(
          `Failed to determine market direction for ${base_asset} with ${num_candles_history_to_check} candles of history`
        )
        this.logger.error({
          object_type: "MarketDirectionInitialiserResult",
          success: false,
          direction: direction || "(null)",
          symbol,
          base_asset,
          num_candles_history_to_check,
        })
      }
    } catch (err) {
      this.logger.error(`MarketDirectionInitialiser.run failed for ${this.market_identifier.symbol}`)
      Sentry.captureException(err)
      this.logger.error({ err })
    }
  }
}
