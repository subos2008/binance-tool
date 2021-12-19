#!./node_modules/.bin/ts-node
/**
 * Load edge interface
 *
 * Set starting date range somehow
 *
 * Have a classes to:
 * - get candles and insert new candles
 *    - it loads candles first and can be called to perform both actions: get from date range and send events
 *    - can also source price data
 * - track positions
 * - track price movements
 * - track when stops are hit on the exchange from price movements
 * - turn positions and price history into:
 *    - max drawdowns
 *    - final profit/loss percentage figures
 */

import { strict as assert } from "assert"
require("dotenv").config()

const service_name = "edge58-backtester"

import binance from "binance-api-node"
import { Binance } from "binance-api-node"
const exchange = "binance"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { Edge58EntrySignals, Edge58EntrySignalsCallbacks } from "../../classes/edges/edge58"
import { CandlesCollector } from "../../classes/utils/candle_utils"
import BigNumber from "bignumber.js"
import { Edge58Parameters, Edge58PositionEntrySignal } from "../../events/shared/edge58-position-entry"

/**
 * Configuration
 */
const quote_symbol = "USDT".toUpperCase()
const _symbol = `BTC${quote_symbol}`
const edge58_parameters: Edge58Parameters = {
  candles_of_price_history: 2,
  candle_timeframe: "1w",
}
let _start_date = new Date("2017-12-20")
let _end_date = new Date("2019-04-15")

/**
 * ------------------------------------------------------------
 */

class PositionTracker implements Edge58EntrySignalsCallbacks {
  position_size = new BigNumber(0)
  direction: "short" | "long" | undefined = undefined
  logger: Logger
  event_log: Edge58PositionEntrySignal[] = []

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    logger: Logger
  }): void {
    if (this.position_size.isGreaterThan(0) || this.direction) {
      throw new Error(`enter position called when already in a position`)
    }
    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"
    this.logger.info(`${direction_string} entry triggered on ${symbol} at price ${entry_price.toFixed()}`)
    this.push_entry_event({
      symbol,
      entry_price,
      direction,
    })
  }

  private push_entry_event({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }) {
    let event: Edge58PositionEntrySignal = {
      version: "v1",
      market_identifier: {
        version: "v2",
        exchange_identifier: { version: "v2", exchange },
        symbol,
      },
      event_type: "Edge58EntrySignal",
      edge58_parameters,
      edge58_entry_signal: {
        direction,
        entry_price: entry_price.toFixed(),
      },
    }
    this.event_log.push(event)
  }
}

class Edge58Backtester {
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  tracker: PositionTracker

  constructor({ ee, logger }: { ee: Binance; logger: Logger }) {
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.tracker = new PositionTracker({ logger })
  }

  async run({ start_date, end_date, symbol }: { start_date: Date; end_date: Date; symbol: string }) {
    let edge: Edge58EntrySignals
    let timeframe = edge58_parameters.candle_timeframe

    this.logger.info(`Symbol: ${symbol}`)
    this.logger.info(`Start date: ${start_date}`)
    this.logger.info(`End date: ${end_date}`)

    try {
      // Last N closed weekly candles exist between N+1 weeks ago and now
      start_date.setDate(start_date.getDate() + (edge58_parameters.candles_of_price_history + 1) * 7)
      let candles = await this.candles_collector.get_candles_between({
        timeframe,
        symbol,
        start_date,
        end_date,
      })
      this.logger.info(`Loaded ${candles.length} candles, timeframe: ${timeframe}`)
      if (candles.length == 0) {
        // prob just means not listed on Binance
        this.logger.info(`No candles loaded for ${symbol}`)
        throw new Error(`No candles loaded for ${symbol}`)
      }

      /**
       * Split out the initial price history and pass it as initial_candles, the rest we pass in as if they are fresh new candles
       */
      let initial_candles = candles.splice(0, edge58_parameters.candles_of_price_history - 1)
      if (initial_candles.length > edge58_parameters.candles_of_price_history) {
        // we must have picked up some partial candles
        this.logger.error(`Wrong number of candles for ${symbol}`)
        throw new Error(`Wrong number of candles for ${symbol}`)
      }
      edge = new Edge58EntrySignals({
        logger: this.logger,
        initial_candles,
        symbol,
        callbacks: this.tracker,
        edge58_parameters,
      })
      for (const candle of candles) {
        edge.ingest_new_candle({ symbol, timeframe, candle })
      }
    } catch (err) {
      if (err.toString().includes("Invalid symbol")) {
        console.info(`Unable to load candles for ${symbol} not listed on binance`)
      } else if (err.toString().includes("No candles loaded for")) {
        console.warn(`Unable to load candles for ${symbol}.`)
      }

      Sentry.captureException(err)
      console.error(err)
    }
  }
}

let edge58: Edge58Backtester | null
async function main() {
  assert(process.env.APIKEY)
  assert(process.env.APISECRET)
  var ee: Binance = binance({
    apiKey: process.env.APIKEY || "foo",
    apiSecret: process.env.APISECRET || "foo",
  })

  try {
    edge58 = new Edge58Backtester({
      ee,
      logger,
    })
    await edge58.run({ start_date: _start_date, end_date: _end_date, symbol: _symbol })
  } catch (error) {
    console.error(error)
  }
}

main().catch((error) => {
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})
