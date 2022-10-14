#!./node_modules/.bin/ts-node

import Sentry from "../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import "./tracer" // must come before importing any instrumented module.

import { strict as assert } from "assert"
import express, { Request, Response } from "express"
import { BinanceCandlesCollector } from "../../classes/candles/candle_utils"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { BaseAssetsList } from "./base-assets-list"
import { Edge70Signals } from "./signals"
import { Edge70Parameters, Edge70Signal } from "./interfaces/edge70-signal"
import { Edge70SignalCallbacks } from "./interfaces/_internal"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { MarketData } from "./market-data"
import { Edge70AMQPSignalPublisher } from "./publisher"
import { SendMessageFunc } from "../../interfaces/send-message"
import { MarketIdentifier_V5_with_base_asset } from "../../events/shared/market-identifier"
import { DirectionPersistence } from "./interfaces/direction-persistance"
import { DirectionPersistenceRedis } from "./market-direction-persistance"
import { MarketDirectionInitialiser } from "./market-direction-initialiser"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { ServiceLogger } from "../../interfaces/logger"
import { SendMessage } from "../../classes/send_message/publish"
import binance from "binance-api-node"
import { Binance } from "binance-api-node"

/** Config: */
const quote_symbol = "USDT".toUpperCase()
const service_name = "edge70-signals"
let to_symbol = (base_asset: string) => base_asset.toUpperCase() + quote_symbol

import { config } from "../../config"
import { BinancePriceGetter } from "../../interfaces/exchanges/binance/binance-price-getter"
const tas_quote_asset = config.binance.spot.tas_quote_asset

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false, level: "debug" })
logger.event({}, { object_type: "ServiceStarting", msg: "Service starting" })

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const multi_configuration: { [config_name: string]: Edge70Parameters } = {
  "edge70-45": {
    // days_of_price_history should be one less than the value we use in the TV high/low indicator
    // because the high/low indicator includes the new candle in it's count
    candle_timeframe: "1d",
    candles_of_price_history: {
      long: 44, // one less than the number we use on the TV high/low indicator
      short: 21, // one less than the number we use on the TV high/low indicator
    },
  },
  "edge70-60": {
    // days_of_price_history should be one less than the value we use in the TV high/low indicator
    // because the high/low indicator includes the new candle in it's count
    candle_timeframe: "1d",
    candles_of_price_history: {
      long: 59, // one less than the number we use on the TV high/low indicator
      short: 21, // one less than the number we use on the TV high/low indicator
    },
  },
}

const config_name: string | undefined = process.env.EDGE_CONFIGURATION_NAME
if (!config_name) throw new Error(`Need to set EDGE_CONFIGURATION_NAME in env`)
if (!(config_name in multi_configuration))
  throw new Error(
    `Configuration name ${config_name} not known/defined. Valid values are: ${Object.keys(
      multi_configuration
    ).join(", ")}`
  )
const edge70_parameters: Edge70Parameters = multi_configuration[config_name]

const edge: "edge70" = "edge70"

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})
const init_health = health_and_readiness.addSubsystem({
  name: "init-boot",
  healthy: true,
  initialised: false,
})
const candle_ingestion_health = health_and_readiness.addSubsystem({
  name: "candle-ingestion",
  healthy: true,
  initialised: false,
})

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
  send_message(`UnhandledPromiseRejection: ${err} - not setting global_health to false`)
  service_is_healthy.healthy(false)
})

class Edge70SignalsService {
  edges: { [Key: string]: Edge70Signals } = {}
  candles_collector: BinanceCandlesCollector
  ee: Binance
  logger: ServiceLogger
  close_short_timeframe_candle_ws: (() => void) | undefined
  close_1d_candle_ws: (() => void) | undefined
  send_message: SendMessageFunc
  direction_persistance: DirectionPersistence
  exchange_info_getter: BinanceExchangeInfoGetter
  health_and_readiness: HealthAndReadiness
  callbacks: Edge70SignalCallbacks

  constructor({
    ee,
    exchange_identifier,
    logger,
    send_message,
    direction_persistance,
    callbacks,
  }: {
    ee: Binance
    logger: ServiceLogger
    send_message: SendMessageFunc
    direction_persistance: DirectionPersistence
    health_and_readiness: HealthAndReadiness
    exchange_identifier: ExchangeIdentifier_V4
    callbacks: Edge70SignalCallbacks
  }) {
    this.candles_collector = new BinanceCandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting", { edge })
    this.direction_persistance = direction_persistance
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
    this.health_and_readiness = health_and_readiness
    this.callbacks = callbacks
  }

  async init(): Promise<void> {
    await this.callbacks.init()
  }

  async run() {
    let base_assets_generator = new BaseAssetsList({
      logger: this.logger,
      exchange_info_getter: this.exchange_info_getter,
    })
    let base_assets: string[] = await base_assets_generator.get_base_assets_list({
      signals_quote_asset: quote_symbol,
      tas_quote_asset: tas_quote_asset,
    })
    this.logger.event(
      {},
      {
        object_type: `EdgeInitialization`,
        msg: `Target markets: ${base_assets.join(", ")}`,
      }
    )

    let required_initial_candles = Edge70Signals.required_initial_candles(edge70_parameters)
    let symbols_with_direction_uninitialised: string[] = []
    const health_and_readiness_subsystem = health_and_readiness.addSubsystem({
      name: `Edge70Signals`,
      healthy: true,
      initialised: true,
    })
    for (let i = 0; i < base_assets.length; i++) {
      let base_asset = base_assets[i]
      let symbol = to_symbol(base_asset)
      let tags = { base_asset, symbol, edge }
      // not all of these will be on Binance
      try {
        // Last N closed candles exist between N+1 ago and now (actually and midnight last night)
        let start_date = new Date()
        let end_date = new Date(start_date)
        let candles_preload_start_date = new Date(start_date)
        candles_preload_start_date.setDate(candles_preload_start_date.getDate() - (required_initial_candles + 1))
        let initial_candles = await this.candles_collector.get_candles_between({
          timeframe: edge70_parameters.candle_timeframe,
          symbol,
          start_date: candles_preload_start_date,
          end_date,
        })

        if (initial_candles.length == 0) {
          this.logger.error({ object_type: `EdgeInitialization`, ...tags }, `No candles loaded for ${symbol}`)
          let err = new Error(`No candles loaded for ${symbol}`)
          Sentry.captureException(err) // this is unexpected now, 429?
          throw err
        } else {
          this.logger.event(tags, {
            object_type: `EdgeInitialization`,
            msg: `Loaded ${initial_candles.length} candles for ${symbol}`,
          })
        }

        // chop off the most recent candle as the code above gives us a partial candle at the end
        if (initial_candles.length > 0 && initial_candles[initial_candles.length - 1].closeTime > Date.now()) {
          let partial_candle = initial_candles.pop()
          if (partial_candle) assert(partial_candle.closeTime > Date.now()) // double check that was actually a partial candle
        }

        let market_identifier: MarketIdentifier_V5_with_base_asset = {
          object_type: "MarketIdentifier",
          version: 5,
          exchange_identifier: this.exchange_info_getter.get_exchange_identifier(),
          base_asset,
          symbol,
        }

        this.edges[symbol] = new Edge70Signals({
          logger: this.logger,
          send_message: this.send_message,
          health_and_readiness: health_and_readiness_subsystem,
          initial_candles,
          market_identifier,
          callbacks: this.callbacks,
          direction_persistance: this.direction_persistance,
          edge70_parameters,
        })
        this.logger.event(tags, {
          object_type: "EdgeInitialization",
          msg: `Setup edge for ${symbol} with ${initial_candles.length} initial candles`,
        })

        if (this.edges[symbol].full() && (await this.edges[symbol].current_market_direction()) === null) {
          /* if this is true and there's more history available than we just loaded
           * we could probably run a background job to add the history */
          symbols_with_direction_uninitialised.push(symbol)

          let mi = new MarketDirectionInitialiser({
            logger,
            direction_persistance: this.direction_persistance,
            candles_collector: this.candles_collector,
            market_identifier,
            edge70_parameters,
          })
          this.logger.warn(
            { ...tags, object_type: "EdgeInitialization" },
            `Starting MarketDirectionInitialiser for ${market_identifier.symbol}`
          )
          await mi.run()
        }

        // TODO: get klines via the TAS so we can do rate limiting
        await sleep(400) // 1200 calls allowed per minute per IP address, sleep(200) => 300/minute or 600/m if market initialising
      } catch (err: any) {
        Sentry.captureException(err)
        this.logger.error({ err })
      }
    }

    let valid_symbols = Object.keys(this.edges)
    this.logger.event(
      {},
      { object_type: "EdgeInitialization", msg: `Edges initialised for ${valid_symbols.length} symbols.` }
    )
    this.send_message(`initialised for ${valid_symbols.length} symbols.`, { edge })
    this.logger.event(
      {},
      {
        object_type: "MarketDirectionInitialiser",
        msg: `${
          symbols_with_direction_uninitialised.length
        } symbols with uninitialised market direction: ${symbols_with_direction_uninitialised.join(", ")})`,
      }
    )
    if (symbols_with_direction_uninitialised.length)
      this.send_message(
        `Started MarketDirectionInitialiser for ${symbols_with_direction_uninitialised.length} symbols.`,
        { edge }
      )

    this.close_1d_candle_ws = this.ee.ws.candles(valid_symbols, edge70_parameters.candle_timeframe, (candle) => {
      let symbol = candle.symbol
      if (candle.isFinal && this.edges[symbol]) {
        this.edges[symbol].ingest_new_candle({ symbol, candle }).catch(() => {
          this.logger.error(`Candle ingestion failed: $`)
          candle_ingestion_health.healthy(false)
        })
      }
    })
    candle_ingestion_health.initialised(true)
  }

  shutdown_streams() {
    if (this.close_1d_candle_ws) this.close_1d_candle_ws()
    if (this.close_short_timeframe_candle_ws) this.close_short_timeframe_candle_ws()
  }
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)

async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  var ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })
  let exchange_identifier: ExchangeIdentifier_V4 = { version: 4, exchange: "binance", exchange_type: "spot" }

  try {
    let redis: RedisClientType = await get_redis_client(logger, health_and_readiness)

    let publisher = new Edge70AMQPSignalPublisher({
      logger,
      send_message,
      health_and_readiness,
      edge,
      edge70_parameters,
      market_data: new MarketData(),
    })

    async function send_test_signal(req: Request, res: Response) {
      try {
        let base_asset = "ETH"
        let symbol = to_symbol(base_asset)
        let market_identifier: MarketIdentifier_V5_with_base_asset = {
          object_type: "MarketIdentifier",
          version: 5,
          exchange_identifier,
          symbol,
          base_asset,
        }
        let direction: "long" | "short" = "long"
        let price_getter = new BinancePriceGetter({ logger, ee })
        let signal_price = (await price_getter.get_current_price({ market_symbol: symbol })).toFixed()

        let event: Edge70Signal = {
          object_type: "Edge70Signal",
          version: 1,
          // msg: `trend reversal ${direction_string} entry signal on ${base_asset} at ${days}d price ${signal_price.toFixed()}. ${market_data_string}`,
          msg: `Test Signal`,
          test_signal: true,
          base_asset,
          direction,
          edge,
          market_identifier,
          edge70_parameters: edge70_parameters,
          signal: {
            direction,
            signal_price,
            signal_timestamp_ms: Date.now(),
          },
        }
        void publisher.publish(event)
        res.send({ status: "OK", event })
      } catch (err) {
        logger.exception({}, err)
      }
    }
    app.get("/send-test-signal", send_test_signal)

    let { exchange, exchange_type } = exchange_identifier
    let market_direction_slug = `${edge70_parameters.candles_of_price_history.long}L${edge70_parameters.candles_of_price_history.short}S`
    let service = new Edge70SignalsService({
      ee,
      exchange_identifier,
      logger,
      send_message,
      health_and_readiness,
      direction_persistance: new DirectionPersistenceRedis({
        logger,
        prefix: `${service_name}:${exchange_type}:${exchange}:${quote_symbol.toLowerCase()}_quote`,
        redis,
        edge_parameters_slug: market_direction_slug,
      }),
      callbacks: publisher,
    })

    await service.init()
    init_health.initialised(true)

    await service.run()
  } catch (err) {
    logger.error({ err })
    Sentry.captureException(err)
  }
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
})
