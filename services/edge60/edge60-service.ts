#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const num_coins_to_monitor = 500
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge60"

import binance, { ExchangeInfo } from "binance-api-node"
import { Binance } from "binance-api-node"
const exchange = "binance"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const humanNumber = require("human-number")

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })
import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { CandlesCollector } from "../../classes/utils/candle_utils"
import { CoinGeckoAPI, CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge60EntrySignals, Edge60EntrySignalsCallbacks } from "../../classes/edges/edge60"
import { Edge60Parameters, Edge60PositionEntrySignal } from "../../events/shared/edge60-position-entry"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { DirectionPersistance } from "./direction-persistance"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { config } from "../../config"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { EdgeDirectionSignal, EdgeDirectionSignalPublisher } from "../../events/shared/edge-direction-signal"
import { get_redis_client } from "../../lib/redis-v4"
import { RedisClientType } from "redis-v4"
import { StatsD } from "hot-shots"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { disallowed_base_assets_for_entry } from "../../lib/stable-coins"
import { BaseAssetsList } from "./base-assets-list"

var statsd = new StatsD()

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${err}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let publisher: GenericTopicPublisher = new GenericTopicPublisher({ logger, event_name: "Edge60EntrySignal" })
let publisher_for_EdgeDirectionSignal = new EdgeDirectionSignalPublisher({ logger, statsd })

const edge60_parameters: Edge60Parameters = {
  days_of_price_history: 22,
}

let edge = "edge60"

class Edge60Service implements Edge60EntrySignalsCallbacks {
  edges: { [Key: string]: Edge60EntrySignals } = {}
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  close_short_timeframe_candle_ws: (() => void) | undefined
  close_1d_candle_ws: (() => void) | undefined
  send_message: SendMessageFunc
  market_data: CoinGeckoMarketData[] | undefined
  direction_persistance: DirectionPersistance
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor({
    ee,
    logger,
    send_message,
    direction_persistance,
  }: {
    ee: Binance
    logger: Logger
    send_message: SendMessageFunc
    direction_persistance: DirectionPersistance
  }) {
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting", { edge })
    this.direction_persistance = direction_persistance
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
  }

  async enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): Promise<void> {
    let base_asset: string = await this.base_asset_for_symbol(symbol)
    let market_data_for_symbol: CoinGeckoMarketData | undefined
    let market_data_string = ""

    try {
      market_data_for_symbol = await this.market_data_for_symbol(symbol)
      if (market_data_for_symbol) {
        market_data_string = `RANK: ${market_data_for_symbol.market_cap_rank}, MCAP: ${humanNumber(
          new BigNumber(market_data_for_symbol.market_cap).sd(2).toFixed()
        )}`
      }
    } catch (e) {
      // This can happen
      this.logger.warn(`Failed to generate market_data string for ${symbol}`)
      Sentry.captureException(e)
    }
    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"

    let previous_direction = await this.direction_persistance.get_direction(base_asset)
    this.direction_persistance.set_direction(base_asset, direction)

    if (previous_direction === null) {
      this.send_message(
        `possible ${direction_string} entry signal on ${base_asset} - check manually if this is a trend reversal.`,
        { edge }
      )
      return
    }

    let direction_change = previous_direction && previous_direction != direction
    let entry_filter = direction_change
    if (entry_filter) {
      try {
        let days = edge60_parameters.days_of_price_history
        let msg = `trend reversal ${direction_string} entry signal on ${base_asset} at ${days}d price ${entry_price.toFixed()}. ${market_data_string}`
        this.logger.info({ signal: "entry", direction, symbol }, msg)
        this.send_message(msg, { edge })
      } catch (e) {
        this.logger.warn(`Failed to publish to telegram for ${symbol}`)
        // This can happen if top 100 changes since boot and we refresh the cap list
        Sentry.captureException(e)
      }

      let market_identifier: MarketIdentifier_V3 = {
        version: "v3",
        // TODO: pull exchange_identifier from ee
        exchange_identifier: { version: "v3", exchange, type: "spot", account: "default" },
        symbol,
        base_asset,
      }
      let signal_timestamp_ms = +Date.now()

      try {
        this.publish_entry_to_amqp({
          symbol,
          entry_price,
          direction,
          previous_direction,
          market_data_for_symbol,
          signal_timestamp_ms,
          market_identifier,
        })
      } catch (e) {
        this.logger.warn(`Failed to publish to AMQP for ${symbol}`)
        // This can happen if top 100 changes since boot and we refresh the cap list
        Sentry.captureException(e)
      }

      try {
        this.publish_direction_to_amqp({
          signal_timestamp_ms,
          market_identifier,
          direction,
          base_asset,
        })
      } catch (e) {
        this.logger.warn(`Failed to publish direction to AMQP for ${symbol}`)
        // This can happen if top 100 changes since boot and we refresh the cap list
        Sentry.captureException(e)
      }
    } else {
      this.logger.info(`${symbol} ${direction} price triggered but not trend reversal`)
    }
  }

  async publish_entry_to_amqp({
    symbol,
    entry_price,
    direction,
    previous_direction,
    market_data_for_symbol,
    signal_timestamp_ms,
    market_identifier,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    previous_direction: "long" | "short"
    market_data_for_symbol: CoinGeckoMarketData | undefined
    signal_timestamp_ms: number
    market_identifier: MarketIdentifier_V3
  }) {
    let event: Edge60PositionEntrySignal = {
      version: "v1",
      edge: "edge60",
      market_identifier,
      object_type: "Edge60EntrySignal",
      edge60_parameters,
      edge60_entry_signal: {
        direction,
        entry_price: entry_price.toFixed(),
        signal_timestamp_ms,
      },
      extra: {
        previous_direction,
        CoinGeckoMarketData: market_data_for_symbol,
      },
    }
    this.logger.info(JSON.stringify(event))
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    publisher.publish(event, options)
  }

  async publish_direction_to_amqp({
    direction,
    market_identifier,
    signal_timestamp_ms,
  }: {
    direction: "long" | "short"
    signal_timestamp_ms: number
    base_asset: string
    market_identifier: MarketIdentifier_V3
  }) {
    let event: EdgeDirectionSignal = {
      object_type: "EdgeDirectionSignal",
      version: "v1",
      edge: "edge61",
      market_identifier,
      direction,
      exchange_type: market_identifier.exchange_identifier.type,
      base_asset: market_identifier.base_asset,
      quote_asset: market_identifier.quote_asset,
      symbol: market_identifier.symbol,
      signal_timestamp_ms: signal_timestamp_ms.toString(),
    }
    this.logger.info(JSON.stringify(event))
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    publisher_for_EdgeDirectionSignal.publish(event, options)
  }

  async base_asset_for_symbol(symbol: string): Promise<string> {
    let exchange_info = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols
    let match = symbols.find((s) => s.symbol === symbol)
    if (!match) throw new Error(`No match for symbol ${symbol} in exchange_info symbols`)
    return match.baseAsset
  }

  async market_data_for_symbol(symbol: string): Promise<CoinGeckoMarketData | undefined> {
    let usym = await this.base_asset_for_symbol(symbol)
    if (!this.market_data) throw new Error(`Market data not initialised.`) // can happen if data updates and
    let data = this.market_data.find((x) => x.symbol.toUpperCase() === usym)
    // if (!data) throw new Error(`Market data for symbol ${usym} not found.`) // can happen if data updates and
    return data
  }

  async run() {
    /** New world demo */
    let base_assets_generator = new BaseAssetsList({
      logger: this.logger,
      exchange_info_getter: this.exchange_info_getter,
    })
    let base_assets: string[] = await base_assets_generator.get_base_assets_list({
      signals_quote_asset: quote_symbol,
      tas_quote_asset: config.tas_quote_asset,
    })
    this.logger.info(`V2 target markets: ${base_assets.join(", ")}`)

    let limit = num_coins_to_monitor
    let cg = new CoinGeckoAPI()
    // not all of these will be on Binance
    this.market_data = await cg.get_top_market_data({ limit })
    let to_symbol = (base_asset: string) => base_asset.toUpperCase() + quote_symbol
    let required_initial_candles = Edge60EntrySignals.required_initial_candles(edge60_parameters)
    for (let i = 0; i < base_assets.length; i++) {
      let symbol = to_symbol(base_assets[i])
      // not all of these will be on Binance, they just throw if missing
      try {
        // Last N closed candles exist between N+1 ago and now (actually and midnight last night)
        let start_date = new Date()
        let end_date = new Date(start_date)
        let candles_preload_start_date = new Date(start_date)
        candles_preload_start_date.setDate(candles_preload_start_date.getDate() - (required_initial_candles + 1))
        let initial_candles = await this.candles_collector.get_candles_between({
          timeframe: "1d",
          symbol,
          start_date: candles_preload_start_date,
          end_date,
        })

        if (initial_candles.length == 0) {
          this.logger.error(`No candles loaded for ${symbol}`)
          let err = new Error(`No candles loaded for ${symbol}`)
          Sentry.captureException(err) // this is unexpected now, 429?
          throw err
        }

        // chop off the most recent candle as the code above gives us a partial candle at the end
        if (initial_candles[initial_candles.length - 1].closeTime > Date.now()) {
          let partial_candle = initial_candles.pop()
          if (partial_candle) assert(partial_candle.closeTime > Date.now()) // double check that was actually a partial candle
        }

        this.edges[symbol] = new Edge60EntrySignals({
          logger: this.logger,
          initial_candles,
          symbol,
          market_data: this.market_data[i],
          callbacks: this,
          edge60_parameters,
        })
        this.logger.info(`Setup edge for ${symbol} with ${initial_candles.length} initial candles`)
        await sleep(200) // 1200 calls allowed per minute per IP address
      } catch (err: any) {
        Sentry.captureException(err)
        this.logger.error({ err })
      }
    }
    let valid_symbols = Object.keys(this.edges)
    this.logger.info(`Edges initialised for ${valid_symbols.length} symbols.`)
    this.send_message(`initialised for ${valid_symbols.length} symbols.`, { edge })

    this.close_1d_candle_ws = this.ee.ws.candles(valid_symbols, "1d", (candle) => {
      let symbol = candle.symbol
      let timeframe = "1d"
      if (this.edges[symbol]) {
        if (candle.isFinal) {
          this.edges[symbol].ingest_new_candle({ symbol, timeframe, candle })
        }
      }
    })
  }

  shutdown_streams() {
    if (this.close_1d_candle_ws) this.close_1d_candle_ws()
    if (this.close_short_timeframe_candle_ws) this.close_short_timeframe_candle_ws()
  }
}

let edge60: Edge60Service | null
async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  var ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })

  try {
    const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
    const health_and_readiness = new HealthAndReadiness({ logger, send_message })
    const redis_health = health_and_readiness.addSubsystem({ name: "redis", ready: false, healthy: false })
    let redis: RedisClientType = await get_redis_client(logger, redis_health)

    edge60 = new Edge60Service({
      ee,
      logger,
      send_message,
      direction_persistance: new DirectionPersistance({
        logger,
        prefix: `${service_name}:spot:binance:usd_quote`,
        send_message,
        redis,
      }),
    })
    await publisher.connect()
    await edge60.run()
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
