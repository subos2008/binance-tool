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
import {
  Edge58Events,
  Edge58Parameters,
  Edge58EntrySignal,
  Edge58ExitSignal,
} from "../../events/shared/edge58-position-entry"
import { PositionChangeEvents } from "../../events/shared/position-change-events"
import { MarketIdentifier_V2 } from "../../events/shared/market-identifier"

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

class PositionEventLogAnalyser {
  logger: Logger
  events: PositionChangeEvents[] = []

  constructor({ logger, events }: { logger: Logger; events: PositionChangeEvents[] }) {
    this.logger = logger
    this.events = events
  }

  run() {
    for (const event of this.events) {
      this.logger.info(event)
    }
  }
}
class PositionTracker implements Edge58EntrySignalsCallbacks {
  logger: Logger
  event_log: Edge58Events[] = []
  events: PositionChangeEvents[] = []

  symbol: string | undefined
  position_size = new BigNumber(0)
  direction: "short" | "long" | undefined = undefined
  stop_price: BigNumber | undefined

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  stopped_out() {
    if (!this.direction) throw new Error("direction was not defined")
    if (!this.stop_price) throw new Error("direction was not defined")
    if (!this.symbol) throw new Error("symbol was not defined")

    let stop_price = this.stop_price
    let position_size = this.position_size
    let direction = this.direction
    let symbol = this.symbol

    this.position_size = new BigNumber(0)
    this.direction = undefined
    this.stop_price = undefined
    this.symbol = undefined

    this.push_stopped_out_event({
      position_size,
      direction,
      stop_price,
      symbol,
    })
  }

  // TODO: add enter_position and add_to_position booleans to this so we can use it for
  // both entering and adding to position depending on filters in the Edge class
  enter_or_add_to_position({
    symbol,
    entry_price,
    direction,
    stop_price,
    enter_position_ok,
    add_to_position_ok,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    logger: Logger
    stop_price: BigNumber
    enter_position_ok: boolean
    add_to_position_ok: boolean
  }): void {
    if (this.position_size.isGreaterThan(0) || this.direction) {
      throw new Error(`enter position called when already in a position`)
    }

    this.stop_price = stop_price

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
    let market_identifier: MarketIdentifier_V2 = {
      version: "v2",
      exchange_identifier: { version: "v2", exchange },
      symbol,
    }

    let event: Edge58EntrySignal = {
      event_type: "Edge58EntrySignal",
      version: "v1",
      market_identifier,
      edge58_parameters,
      edge58_entry_signal: {
        direction,
        entry_price: entry_price.toFixed(),
      },
    }
    this.event_log.push(event)

    /**
     * Convert Edge58EntrySignal to PositionEntryExecutionLog
     */
    this.events.push({
      version: "v1",
      event_type: "PositionEntryExecutionLog",
      market_identifier,
      direction,
      entry_price: event.edge58_entry_signal.entry_price,
    })
  }

  private push_stopped_out_event({
    position_size,
    direction,
    stop_price,
    symbol,
  }: {
    position_size: BigNumber
    stop_price: BigNumber
    direction: "long" | "short"
    symbol: string
  }) {
    let market_identifier: MarketIdentifier_V2 = {
      version: "v2",
      exchange_identifier: { version: "v2", exchange },
      symbol,
    }

    let event: Edge58ExitSignal = {
      event_type: "Edge58ExitSignal",
      version: "v1",
      market_identifier,
      edge58_parameters,
      edge58_exit_signal: {
        signal: "stopped_out",
        direction,
        exit_price: stop_price.toFixed(),
      },
      position: {
        position_size: position_size.toFixed(),
      },
    }
    this.event_log.push(event)

    /**
     * Convert Edge58ExitSignal to PositionExitExecutionLog
     */
    this.events.push({
      version: "v1",
      event_type: "PositionExitExecutionLog",
      market_identifier,
      direction,
      signal: "stopped_out",
      exit_price: event.edge58_exit_signal.exit_price,
    })
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
        if (this.tracker.direction == "long") {
          let candle_low_price = new BigNumber(candle.low)
          if (!this.tracker.stop_price) throw new Error("stop_price is undefined")
          if (candle_low_price.isLessThanOrEqualTo(this.tracker.stop_price)) {
            this.tracker.stopped_out()
          }
        }
        if (this.tracker.direction == "short") {
          let candle_high_price = new BigNumber(candle.high)
          if (!this.tracker.stop_price) throw new Error("stop_price is undefined")
          if (candle_high_price.isGreaterThanOrEqualTo(this.tracker.stop_price)) {
            this.tracker.stopped_out()
          }
        }
        edge.ingest_new_candle({ symbol, timeframe, candle })
      }
      let analyser = new PositionEventLogAnalyser({ logger: this.logger, events: this.tracker.events })
      analyser.run()
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
