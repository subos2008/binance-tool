#!./node_modules/.bin/ts-node

const Logger = require("../../lib/faux_logger")
// Initial logger, we re-create it below once we have the trade_id
var logger = new Logger({ silent: false })
require("dotenv").config()

import * as Sentry from "@sentry/node"
import BigNumber from "bignumber.js"
Sentry.init({
  dsn: "https://5f5398dfd6b0475ea6061cf39bc4ed03@sentry.io/5178400",
})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "binance-tool")
})

import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

const { promisify } = require("util")
const hgetallAsync = promisify(redis.hgetall).bind(redis)
import binance, { CancelOrderResult } from "binance-api-node"
import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"
import { threadId } from "worker_threads"
import { assert } from "console"

var { argv } = require("yargs").string("symbol").demand("symbol")
let { "symbol": symbol } = argv

logger = new Logger({ silent: false, template: { symbol } })

process.on("unhandledRejection", (error) => {
  logger.error(error)
})

class CandlesCollector {
  start_date: Date
  ee: Binance
  symbol: string

  constructor({ ee, symbol, start_date }: { ee: any; symbol: string; start_date: Date }) {
    this.start_date = start_date
    this.ee = ee
    this.symbol = symbol.toUpperCase()
  }

  async get_daily_candles_between(start_date: Date, end_date: Date): Promise<CandleChartResult[]> {
    return this.ee.candles({
      symbol: this.symbol,
      interval: CandleChartInterval.ONE_DAY,
      startTime: start_date.getTime(),
      endTime: end_date.getTime(),
    })
  }
}

class CandleUtils {
  static get_highest_price(candles: CandleChartResult[]): BigNumber {
    let high = new BigNumber(candles[0].high)
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let daily_high_price = new BigNumber(candle.high)
      if (daily_high_price.isGreaterThan(high)) {
        high = daily_high_price
      }
    }
    return high
  }

  find_first_daily_candle_with_close_higher_than_price(
    candles: CandleChartResult[],
    price: BigNumber
  ): { daily_close_price: BigNumber; index: number; candle: CandleChartResult } {
    for (let i = 0; i < candles.length; i++) {
      let candle = candles[i]
      let daily_close_price = new BigNumber(candle.close)
      if (daily_close_price.isGreaterThan(price)) {
        return { daily_close_price, index: i, candle }
      }
    }
    throw new Error("No higher daily close price found")
  }
}

class Edge56 {
  start_of_algo_date: Date
  current_high: BigNumber
  latest_price: BigNumber

  in_position: boolean = false
  entry_price: BigNumber
  lowest_price_seen_since_entry: BigNumber

  constructor({
    ee,
    symbol,
    start_of_bullmarket_date,
    start_of_algo_date,
    end_of_algo_date,
    initial_candles,
  }: {
    ee: any
    symbol: string
    start_of_bullmarket_date: Date
    start_of_algo_date: Date
    end_of_algo_date: Date
    initial_candles: CandleChartResult[]
  }) {
    this.current_high = CandleUtils.get_highest_price(initial_candles)
    assert(initial_candles[initial_candles.length - 1].closeTime < start_of_algo_date.getTime())
  }

  private async enter_position(price: BigNumber) {
    if (this.in_position) throw new Error(`Already in position`)
    console.log(`Entering position at price: ${price.toFixed()}`)
    this.lowest_price_seen_since_entry = price
    this.entry_price = price
  }

  percentage_change_since_entry(price: BigNumber) {
    return price.minus(this.entry_price).dividedBy(this.entry_price).times(100).dp(1)
  }

  async ingest_new_candle(candle: CandleChartResult) {
    this.latest_price = new BigNumber(candle.close)
    // TODO: exit strat
    if (this.in_position) {
      let low = new BigNumber(candle.low)
      if (low.isLessThan(this.lowest_price_seen_since_entry)) {
        this.lowest_price_seen_since_entry = low
        console.warn(`Drawdown is now: ${this.percentage_change_since_entry(low)}`)
      }
    } else if (new BigNumber(candle.close).isGreaterThan(this.current_high)) {
      console.log(`Entry!! at ${candle.close}, ${new Date(candle.closeTime)}`)
      this.in_position = true
      this.entry_price = new BigNumber(candle.close)
    }
  }

  async run() {}
}

class Edge56Backtester {
  edge: Edge56
  start_of_bullmarket_date: Date
  start_of_algo_date: Date
  end_of_algo_date: Date
  candles_collector: CandlesCollector
  ee: any

  constructor({
    ee,
    symbol,
    start_of_bullmarket_date,
    start_of_algo_date,
    end_of_algo_date,
  }: {
    ee: any
    symbol: string
    start_of_bullmarket_date: Date
    start_of_algo_date: Date
    end_of_algo_date: Date
  }) {
    this.start_of_bullmarket_date = start_of_bullmarket_date
    this.start_of_algo_date = start_of_algo_date
    this.end_of_algo_date = end_of_algo_date
    this.candles_collector = new CandlesCollector({ ee, symbol, start_date: start_of_bullmarket_date })
    this.ee = ee
  }

  async run() {

    let all_candles = await this.candles_collector.get_daily_candles_between(this.start_of_bullmarket_date, new Date())
    console.log(`${all_candles.length} total candles`)
    let initial_candles = all_candles.filter((candle)=> candle.closeTime<this.start_of_algo_date.getTime())
    console.log(`${initial_candles.length} initial candles`)

    this.edge = new Edge56({
      ee: this.ee,
      symbol,
      start_of_bullmarket_date: this.start_of_bullmarket_date,
      start_of_algo_date: this.start_of_algo_date,
      end_of_algo_date: this.end_of_algo_date,
      initial_candles,
    })

    let candles_to_ingest = all_candles.filter((candle)=> candle.closeTime>=this.start_of_algo_date.getTime())
    console.log(`${candles_to_ingest.length} candles to ingest`)
  }
}

async function main(symbol: string) {
  var ee: Binance = binance({
    apiKey: process.env.APIKEY || "foo",
    apiSecret: process.env.APISECRET || "foo",
  })

  try {
    const start_of_bullmarket_date = new Date("2021-01-01")
    const start_of_algo_date = new Date("2021-04-01")

    const edge56 = new Edge56Backtester({
      ee,
      start_of_bullmarket_date,
      start_of_algo_date,
      end_of_algo_date: new Date(),
      symbol,
    })
    await edge56.run()
    soft_exit(0)
  } catch (error) {
    console.error(error)
  }
}

// TODO: exceptions
main(symbol).catch((error) => {
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})

function soft_exit(exit_code?: number | undefined) {
  console.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) console.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  redis.quit()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
