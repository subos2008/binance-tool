#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
const service_name = "edge70-backtester"

import binance, { CandleChartResult } from "binance-api-node"
import { Binance } from "binance-api-node"

import Sentry from "../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../lib/faux_logger"
const logger: Logger = new Logger({ silent: false })
// const logger: Logger = new Logger({ silent: false, level: "debug" })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { config } from "../../../config"
const tas_quote_asset = config.binance.spot.tas_quote_asset

import { CandlesCollector } from "../../../classes/utils/candle_utils"
import { BinanceExchangeInfoGetter } from "../../../classes/exchanges/binance/exchange-info-getter"
import { HealthAndReadiness } from "../../../classes/health_and_readiness"
import { BaseAssetsList } from "../base-assets-list"
import { Edge70Signals } from "../signals"
import { Edge70Parameters } from "../interfaces/edge70-signal"
import { Edge70SignalCallbacks } from "../interfaces/_internal"
import { DirectionPersistanceMock } from "./direction-persistance-mock"
import { MarketIdentifier_V5_with_base_asset } from "../../../events/shared/market-identifier"
import { Edge70AMQPSignalPublisherMock } from "./publisher-mock"
import { ContextTags, SendMessageFunc } from "../../../interfaces/send-message"
import { DateTime } from "luxon"

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  console.error(`UnhandledPromiseRejection: ${err}`)
  process.exit(1)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const edge70_parameters: Edge70Parameters = {
  // days_of_price_history should be one less than the value we use in the TV high/low indicator
  // because the high/low indicator includes the new candle in it's count
  candle_timeframe: "1d",
  candles_of_price_history: {
    long: 44, // one less than the number we use on the TV high/low indicator
    short: 21, // one less than the number we use on the TV high/low indicator
  },
}

// const backtest_parameters = {
//   base_asset: "BTC",
//   candles: 1000,
//   start_date: new Date("2022-05-04"),
//   end_date: new Date("2022-07-31"), // Nice test, signals long on 29th
// }

const backtest_parameters = {
  start_date: new Date("2020-08-01"),
  end_date: new Date("2022-07-31"),
}

const edge: "edge70-backtest" = "edge70-backtest"

class Edge70SignalsBacktester {
  edges: { [Key: string]: Edge70Signals } = {}
  candles: { [Key: string]: CandleChartResult[] } = {}
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  send_message: SendMessageFunc
  direction_persistance: DirectionPersistanceMock
  exchange_info_getter: BinanceExchangeInfoGetter
  health_and_readiness: HealthAndReadiness
  callbacks: Edge70SignalCallbacks

  constructor({
    ee,
    logger,
    send_message,
    direction_persistance,
    callbacks,
  }: {
    ee: Binance
    logger: Logger
    send_message: SendMessageFunc
    direction_persistance: DirectionPersistanceMock
    health_and_readiness: HealthAndReadiness
    callbacks: Edge70SignalCallbacks
  }) {
    this.candles_collector = new CandlesCollector({ ee })
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

  async init_candles(limit: number) {
    let start = DateTime.fromJSDate(backtest_parameters.start_date)
    let end = DateTime.fromJSDate(backtest_parameters.end_date)
    let days = end.diff(start, "days").toObject().days
    this.logger.info(
      `Running backtest from ${start.toFormat("yyyy LLL dd")} till ${end.toFormat("yyyy LLL dd")} (${days} days)`
    )

    let base_assets_generator = new BaseAssetsList({
      logger: this.logger,
      exchange_info_getter: this.exchange_info_getter,
    })
    let base_assets: string[] = await base_assets_generator.get_base_assets_list({
      signals_quote_asset: quote_symbol,
      tas_quote_asset: tas_quote_asset,
    })
    console.warn(`Chopping to just ${base_assets[0]}`)
    base_assets = base_assets.slice(0, limit)
    this.logger.info(`Target markets: ${base_assets.join(", ")}`)

    let to_symbol = (base_asset: string) => base_asset.toUpperCase() + quote_symbol

    let largest_number_of_candles = 0
    for (let i = 0; i < base_assets.length; i++) {
      let base_asset = base_assets[i]
      let symbol = to_symbol(base_asset)
      let tags = { base_asset, symbol, edge }
      try {
        // Last N closed candles exist between N+1 ago and now (actually and midnight last night)
        // let start_date = new Date()
        // let end_date = new Date(start_date)
        // let candles_preload_start_date = new Date(start_date)
        // candles_preload_start_date.setDate(
        //   candles_preload_start_date.getDate() - (backtest_parameters.candles + 1)
        // )
        let _candles = await this.candles_collector.get_candles_between({
          timeframe: edge70_parameters.candle_timeframe,
          symbol,
          start_date: backtest_parameters.start_date,
          end_date: backtest_parameters.end_date,
        })
        largest_number_of_candles = Math.max(largest_number_of_candles, _candles.length)

        if (_candles.length == 0) {
          this.logger.error(`No candles loaded for ${symbol}`)
          let err = new Error(`No candles loaded for ${symbol}`)
          Sentry.captureException(err) // this is unexpected now, 429?
          throw err
        } else {
          // chop off the most recent candle as the code above gives us a partial candle at the end
          if (_candles[_candles.length - 1].closeTime > Date.now()) {
            let partial_candle = _candles.pop()
            if (partial_candle) assert(partial_candle.closeTime > Date.now()) // double check that was actually a partial candle
          }

          this.candles[symbol] = _candles
          this.logger.info(`Loaded ${this.candles[symbol].length} candles for ${symbol}`)
        }

        let market_identifier: MarketIdentifier_V5_with_base_asset = {
          object_type: "MarketIdentifier",
          version: 5,
          exchange_identifier: this.exchange_info_getter.get_exchange_identifier(),
          base_asset,
          symbol,
        }

        let initial_candles: CandleChartResult[] = []
        this.edges[symbol] = new Edge70Signals({
          set_log_time_to_candle_time: true,
          send_message,
          direction_persistance: this.direction_persistance,
          logger: this.logger,
          health_and_readiness,
          initial_candles,
          market_identifier,
          callbacks: this.callbacks,
          edge70_parameters,
          base_asset,
        })
        this.logger.info(
          { ...tags, object_type: "EdgeMarketInitialization" },
          `Setup edge for ${symbol} with ${initial_candles.length} initial candles`
        )
        // TODO: get klines via the TAS so we can do rate limiting
        if (base_assets.length > 300) {
          this.logger.debug(`Sleeping...`)
          await sleep(400) // 1200 calls allowed per minute per IP address, sleep(200) => 300/minute
          this.logger.warn(`Not sleeping...no rate limiting - add bottleneck`)
        }

        /* delete any candles/edges that have less candles than expected */
        let lens = Object.values(this.candles).map((c) => c.length)
        let expected = Math.max(...lens)
        this.logger.info(`Expecting ${expected} candles`)
        let del_syms = 0
        for (symbol in this.candles) {
          if (this.candles[symbol].length < expected) {
            delete this.candles[symbol]
            delete this.edges[symbol]
            del_syms++
          }
        }
        this.logger.info(`Deleted ${del_syms} short histories`)
      } catch (err) {
        this.logger.error({ err })
        console.error(err)
        Sentry.captureException(err)
        throw err // rethrow in case it's a 429
      }
    }
  }

  async run(): Promise<void> {
    this.logger.warn(`Not checking for STOP out of position on edge70`)
    let count = 0
    outer: while (true) {
      for (const symbol in this.candles) {
        let candle = this.candles[symbol].shift()
        if (!candle) break outer
        await this.edges[symbol].ingest_new_candle({ symbol, candle })
      }
      count++
    }
    this.logger.info(`Run complete. Processed ${count} candles`)
  }
}

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = async (msg: string, tags?: ContextTags) => {
  if (tags) logger.warn(tags, msg)
  else logger.warn(msg)
}
health_and_readiness.addSubsystem({ name: "global", ready: true, healthy: true })

async function main() {
  // assert(process.env.BINANCE_RO_API_KEY)
  // assert(process.env.BINANCE_RO_API_SECRET)
  var ee: Binance = binance({
    // apiKey: process.env.BINANCE_RO_API_KEY || "foo",
    // apiSecret: process.env.BINANCE_RO_API_SECRET || "foo",
  })

  try {
    let publisher = new Edge70AMQPSignalPublisherMock({
      logger: logger,
      health_and_readiness,
      edge,
      edge70_parameters,
    })

    let service = new Edge70SignalsBacktester({
      ee,
      logger,
      send_message,
      health_and_readiness,
      direction_persistance: new DirectionPersistanceMock({
        logger,
        prefix: `${service_name}:spot:binance:usd_quote`,
      }),
      callbacks: publisher,
    })
    await service.init()
    await service.init_candles(5)
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
