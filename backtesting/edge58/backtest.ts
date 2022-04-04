#!/usr/bin/env node --unhandled-rejections=strict -r ts-node/register
/**
 #!./node_modules/.bin/ts-node --unhandled-rejections=strict
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

import binance, { Candle, CandleChartResult } from "binance-api-node"
import { Binance } from "binance-api-node"
const exchange = "binance"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false, template: { name: "edge58" } })
const moment = require("moment")

import { Edge58EntrySignals } from "../../classes/edges/edge58/edge58"
import { Edge58EntrySignalsCallbacks } from "../../classes/edges/edge58/interfaces"

import { CandlesCollector } from "../../classes/utils/candle_utils"
import BigNumber from "bignumber.js"
import {
  Edge58Events,
  Edge58Parameters_V1,
  Edge58EntrySignal,
  Edge58ExitSignal,
} from "../../classes/edges/edge58/events"
import { PositionChangeEvents } from "../../events/shared/position-change-events"
import { MarketIdentifier_V2 } from "../../events/shared/market-identifier"

/**
 * Configuration
 */
const quote_symbol = "USDT".toUpperCase()
const _symbol = `LINK${quote_symbol}`
let fixed_position_size = new BigNumber(300)
const edge58_parameters: Edge58Parameters_V1 = {
  version: "v1",
  candles_of_price_history: 2,
  candle_timeframe: "1w",
  stops: {
    wick_definitions_percentages_of_body: {
      "minimal_wick_less_than": "5",
      "large_wick_greater_than": "10",
    },
    stop_percentages: {
      "minimal_wick": "4",
      "default": "6",
      "large_wick": "12",
    },
  },
  entry_filters: {
    candle_body_percentage_considered_too_large: "35",
    adx_parameters: {
      adx_period: 14, // sets three of the values in TV
      limadx: 17,
    },
  },
}
let _start_date = new Date("2017-12-20")
let _end_date = new Date()

let market_identifier: MarketIdentifier_V2 = {
  version: "v2",
  exchange_identifier: { version: "v2", exchange },
  symbol: _symbol,
}
/**
 * ------------------------------------------------------------
 */

class Trade {
  amount_invested: BigNumber
  position_size: BigNumber

  constructor({ amount_invested, price }: { amount_invested: BigNumber; price: BigNumber }) {
    this.amount_invested = amount_invested
    this.position_size = amount_invested.dividedBy(price)
  }

  add_to_position({ amount_invested, price }: { amount_invested: BigNumber; price: BigNumber }) {
    this.amount_invested = this.amount_invested.plus(amount_invested)
    this.position_size = this.position_size.plus(amount_invested.dividedBy(price))
  }

  exit_position({ price }: { price: BigNumber }) {
    let returns = this.position_size.times(price)
    let profit_loss = returns.minus(this.amount_invested)
    let percentage_profit_loss = profit_loss.dividedBy(this.amount_invested).times(100)
    return { returns, profit_loss, percentage_profit_loss }
  }
}

class PositionEventLogAnalyser {
  logger: Logger
  fixed_position_size: BigNumber // each entry or add is this size
  events: PositionChangeEvents[] = []
  current_trade: Trade | undefined
  capital_required_to_execute_all_trades: BigNumber = new BigNumber(0)
  total_profit_loss: BigNumber = new BigNumber(0)

  constructor({
    logger,
    events,
    fixed_position_size,
  }: {
    logger: Logger
    events: PositionChangeEvents[]
    fixed_position_size: BigNumber
  }) {
    this.logger = logger
    this.events = events
    this.fixed_position_size = fixed_position_size
  }

  run() {
    for (const event of this.events) {
      let direction = event.direction === "long" ? "LONG " : "SHORT"
      switch (event.object_type) {
        case "PositionEntryExecutionLog":
          this.current_trade = new Trade({
            amount_invested: this.fixed_position_size,
            price: new BigNumber(event.entry_price),
          })
          this.logger.info(
            `ENTRY ${moment(event.entry_candle_close_timestamp_ms).format("YYYY MMM DD")} ${direction} at ${
              event.entry_price
            }, stop ${event.stop_price}`
          )
          break
        case "PositionIncreaseExecutionLog":
          if (!this.current_trade) throw new Error(`Not in position`)
          this.current_trade.add_to_position({
            amount_invested: this.fixed_position_size,
            price: new BigNumber(event.entry_price),
          })
          this.logger.info(
            `ADD   ${moment(event.entry_candle_close_timestamp_ms).format("YYYY MMM DD")} ${direction} at ${
              event.entry_price
            }, stop ${event.stop_price}`
          )
          break
        case "PositionExitExecutionLog":
          if (!this.current_trade) throw new Error(`Not in position`)
          let exit_info = this.current_trade.exit_position({ price: new BigNumber(event.exit_price) })
          this.current_trade = undefined
          this.total_profit_loss = this.total_profit_loss.plus(exit_info.profit_loss)
          this.logger.info(
            `EXIT  ${moment(event.exit_candle_close_timestamp_ms).format("YYYY MMM DD")} ${direction} at ${
              event.exit_price
            }, ABS P/L: ${exit_info.profit_loss.dp(0)}, %P/L: ${exit_info.percentage_profit_loss.dp(1)}`
          )
          break
        default:
          throw new Error(`Unknown object_type`)
      }
      if (this.current_trade)
        this.capital_required_to_execute_all_trades = BigNumber.max(
          this.capital_required_to_execute_all_trades,
          this.current_trade.amount_invested
        )
    }
    let x_fixed_investment_amount = this.capital_required_to_execute_all_trades.dividedBy(fixed_position_size)
    this.logger.info(
      `Capital required to invest in all trades is ${
        this.capital_required_to_execute_all_trades
      } (${x_fixed_investment_amount.dp(0)} times fixed investment size)`
    )
    this.logger.info(`Total P/L: ${this.total_profit_loss.dp(0)}`)
  }
}

class PositionTracker implements Edge58EntrySignalsCallbacks {
  logger: Logger
  event_log: Edge58Events[] = []
  events: PositionChangeEvents[] = []

  fixed_position_size = new BigNumber(300) // TODO: make config

  symbol: string | undefined
  position_size = new BigNumber(0) // TODO: probably should remove this
  direction: "short" | "long" | undefined = undefined
  stop_price: BigNumber | undefined

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  in_position(): boolean {
    return this.direction ? true : false
  }

  stopped_out(candle: CandleChartResult) {
    this.logger.error(`Stopped out`)
    if (!this.direction) throw new Error("direction was not defined")
    if (!this.stop_price) throw new Error("direction was not defined")
    if (!this.symbol) throw new Error("symbol was not defined")

    // TODO: should move all this to one object that we assign at once
    let stop_price = this.stop_price
    let position_size = this.position_size // TODO: probably should remove this
    let direction = this.direction
    let symbol = this.symbol

    let market_identifier: MarketIdentifier_V2 = {
      version: "v2",
      exchange_identifier: { version: "v2", exchange },
      symbol,
    }

    let event: Edge58ExitSignal = {
      object_type: "Edge58ExitSignal",
      version: "v1",
      market_identifier,
      edge58_parameters,
      edge58_exit_signal: {
        signal: "stopped_out",
        direction,
        exit_price: stop_price.toFixed(),
      },
      position: {
        // TODO: is this really tracked here?
        position_size: position_size.toFixed(),
      },
      exit_candle_close_timestamp_ms: candle.closeTime,
    }
    this.event_log.push(event)

    this.position_size = new BigNumber(0)
    this.direction = undefined
    this.stop_price = undefined
    this.symbol = undefined

    this.push_stopped_out_execution_event(event)
  }

  // TODO: add enter_position and add_to_position booleans to this so we can use it for
  // both entering and adding to position depending on filters in the Edge class
  enter_or_add_to_position(event: Edge58EntrySignal): void {
    this.event_log.push(event)
    let direction = event.edge58_entry_signal.direction
    let entry_price = event.edge58_entry_signal.entry_price
    let symbol = event.market_identifier.symbol
    let stop_price = event.stop_price

    if (this.in_position()) {
      if (this.direction != direction) {
        this.logger.warn(
          `signal to go ${direction} when already in a ${this.direction} position. This should be difficult / unlikely to see. Skipping signal. Taking no action and waiting for stop out. Maybe check stops?`
        )
        return
      }

      if (event.add_to_position_ok) {
        this.logger.info(`Adding to ${direction} position`)
        let base_amount: BigNumber = this.fixed_position_size
        let quote_amount: BigNumber = this.fixed_position_size.dividedBy(entry_price)
        this.push_add_to_position_execution_event(event, {
          base_amount: base_amount.toFixed(),
          quote_amount: quote_amount.toFixed(),
        })

        /**
         * Update Position Info *************** TODO *********************
         */
        this.stop_price = new BigNumber(stop_price)
        this.position_size = this.position_size.plus(quote_amount)
      }
    } else {
      if (event.enter_position_ok) {
        this.logger.info(`Entering ${direction}`)
        let base_amount: BigNumber = this.fixed_position_size
        let quote_amount: BigNumber = this.fixed_position_size.dividedBy(entry_price)
        this.push_entry_execution_event(event, {
          base_amount: base_amount.toFixed(),
          quote_amount: quote_amount.toFixed(),
        })
        /**
         * Update Position Info *************** TODO *********************
         */
        this.stop_price = new BigNumber(stop_price)
        this.direction = direction
        this.symbol = symbol
        this.position_size = this.fixed_position_size.dividedBy(entry_price)
      }
    }
    this.logger.info(
      `POSITION: ${this.direction} ${
        this.symbol
      } with ${this.position_size.toFixed()}, stop ${this.stop_price?.toFixed()}`
    )
  }

  private push_entry_execution_event(
    event: Edge58EntrySignal,
    order_executed: { base_amount: string; quote_amount: string }
  ) {
    /**
     * Convert Edge58EntrySignal to PositionEntryExecutionLog
     */
    this.events.push({
      version: "v1",
      object_type: "PositionEntryExecutionLog",
      market_identifier: event.market_identifier,
      direction: event.edge58_entry_signal.direction,
      entry_price: event.edge58_entry_signal.entry_price,
      entry_candle_close_timestamp_ms: event.entry_candle_close_timestamp_ms,
      stop_price: event.stop_price,
      order_executed,
    })
  }

  private push_add_to_position_execution_event(
    event: Edge58EntrySignal,
    order_executed: { base_amount: string; quote_amount: string }
  ) {
    /**
     * Convert Edge58EntrySignal to PositionEntryExecutionLog
     */
    this.events.push({
      version: "v1",
      object_type: "PositionIncreaseExecutionLog",
      market_identifier: event.market_identifier,
      direction: event.edge58_entry_signal.direction,
      entry_price: event.edge58_entry_signal.entry_price,
      stop_price: event.stop_price,
      entry_candle_close_timestamp_ms: event.entry_candle_close_timestamp_ms,
      order_executed,
    })
  }

  private push_stopped_out_execution_event(event: Edge58ExitSignal) {
    /**
     * Convert Edge58ExitSignal to PositionExitExecutionLog
     */
    this.events.push({
      version: "v1",
      object_type: "PositionExitExecutionLog",
      market_identifier: event.market_identifier,
      direction: event.edge58_exit_signal.direction,
      signal: "stopped_out",
      exit_price: event.edge58_exit_signal.exit_price,
      position_size: event.position.position_size,
      exit_candle_close_timestamp_ms: event.exit_candle_close_timestamp_ms,
    })
  }
}

export class Edge58Backtester {
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

  async run_candles({ symbol, candles }: { candles: CandleChartResult[]; symbol: string }) {
    this.logger.info(
      `Loaded ${candles.length} candles, starting at close ${new Date(candles[0].closeTime).toDateString()}`
    )

    if (candles.length == 0) {
      // prob just means not listed on Binance
      this.logger.info(`No candles loaded for ${symbol}`)
      throw new Error(`No candles loaded for ${symbol}`)
    }

    /**
     * Split out the initial price history and pass it as initial_candles, the rest we pass in as if they are fresh new candles
     */
    // Add ADX here - more initial candles, presumably.?
    let required_initial_candles = Edge58EntrySignals.required_initial_candles(edge58_parameters)
    this.logger.info(`Initial candles requested: ${required_initial_candles}`)
    let initial_candles = candles.splice(0, required_initial_candles)
    if (initial_candles.length != required_initial_candles) {
      // we must have picked up some partial candles
      let msg = `Wrong number of initial_candles for ${symbol}: got ${initial_candles.length}, expected ${required_initial_candles}`
      this.logger.error(msg)
      throw new Error(msg)
    }
    this.logger.info(
      `Feeding in ${candles.length} post initial_candles, starting at close ${new Date(
        candles[0].closeTime
      ).toDateString()}`
    )
    let edge: Edge58EntrySignals = new Edge58EntrySignals({
      logger: this.logger,
      initial_candles,
      symbol,
      callbacks: this.tracker,
      edge58_parameters,
      market_identifier,
    })
    let timeframe = edge58_parameters.candle_timeframe
    for (const candle of candles) {
      if (this.tracker.direction == "long") {
        let candle_low_price = new BigNumber(candle.low)
        if (!this.tracker.stop_price) throw new Error("stop_price is undefined")
        if (candle_low_price.isLessThanOrEqualTo(this.tracker.stop_price)) {
          this.tracker.stopped_out(candle)
        }
      }
      if (this.tracker.direction == "short") {
        let candle_high_price = new BigNumber(candle.high)
        if (!this.tracker.stop_price) throw new Error("stop_price is undefined")
        if (candle_high_price.isGreaterThanOrEqualTo(this.tracker.stop_price)) {
          this.tracker.stopped_out(candle)
        }
      }

      edge.ingest_new_candle({ symbol, timeframe, candle })
    }
    let analyser = new PositionEventLogAnalyser({
      logger: this.logger,
      events: this.tracker.events,
      fixed_position_size,
    })
    analyser.run()
  }

  async run_dates({ start_date, end_date, symbol }: { start_date: Date; end_date: Date; symbol: string }) {
    let timeframe = edge58_parameters.candle_timeframe
    this.logger.info(`Symbol: ${symbol}`)
    this.logger.info(`Start date: ${start_date}`)
    this.logger.info(`End date: ${end_date}`)
    let required_initial_candles = Edge58EntrySignals.required_initial_candles(edge58_parameters)

    try {
      // Last N closed weekly candles exist between N+1 weeks ago and now
      start_date.setDate(start_date.getDate() - (required_initial_candles + 1) * 7)
      let candles = await this.candles_collector.get_candles_between({
        timeframe,
        symbol,
        start_date,
        end_date,
      })
      const fs = require("fs")
      fs.writeFileSync("./candles.json", JSON.stringify(candles))
      await this.run_candles({ symbol, candles })
    } catch (err) {
      if ((err as any).toString().includes("Invalid symbol")) {
        console.info(`Unable to load candles for ${symbol} not listed on binance`)
      } else if ((err as any).toString().includes("No candles loaded for")) {
        console.warn(`Unable to load candles for ${symbol}.`)
      }
      Sentry.captureException(err)
      console.error(err)
      throw err
    }
  }
}

let edge58: Edge58Backtester | null
async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  var ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })

  edge58 = new Edge58Backtester({ ee, logger })
  await edge58.run_dates({ start_date: _start_date, end_date: _end_date, symbol: _symbol })
}

main().catch((err) => {
  console.error(`Error in main loop: ${err}`)
  console.error(err)
  console.error(`Error in main loop: ${err.stack}`)
})
