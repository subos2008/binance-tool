#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
require("dotenv").config()
const connect_options = require("../../lib/amqp/connect_options").default
const service_name = "edge56"
const routing_key = "binance"

import binance from "binance-api-node"
import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"

var amqp = require("amqplib/callback_api")

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const send_message_factory = require("../../lib/telegram.js")

const send_message = send_message_factory(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

// send_message("starting")

import { CandlesCollector } from "../../classes/utils/candle_utils"
import { Edge56 } from "../../classes/edges/edge56"
import { CoinGeckoAPI, CGMarketData } from "../../classes/utils/coin_gecko"
import { textChangeRangeIsUnchanged } from "typescript"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Edge56Service {
  edges: { [Key: string]: Edge56 } = {}
  start_of_bullmarket_date: Date
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  close_short_timeframe_candle_ws: () => void
  close_1d_candle_ws: () => void

  constructor({
    ee,
    start_of_bullmarket_date,
    logger,
  }: {
    ee: Binance
    start_of_bullmarket_date: Date
    logger: Logger
  }) {
    this.start_of_bullmarket_date = start_of_bullmarket_date
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
  }

  async run() {
    let limit = 250
    let cg = new CoinGeckoAPI()
    // TODO: hmm, not all of these will be on Binance
    let market_data: CGMarketData[] = await cg.get_top_market_data({ limit })
    market_data = market_data.filter((x) => x.id !== "bitcoin")
    let coin_names = market_data.map((x) => x.symbol.toUpperCase())
    console.log(`Top ${limit} coins by market cap: ${coin_names.join(", ")} (BTC excluded)`)
    let to_symbol = (md: CGMarketData) => md.symbol.toUpperCase() + "BTC"
    let symbols = market_data.map(to_symbol)

    this.close_1d_candle_ws = this.ee.ws.candles(symbols, "1d", (candle) => {
      let symbol = candle.symbol
      let timeframe = "1d"
      if (this.edges[symbol]) {
        if (candle.isFinal) this.edges[symbol].ingest_new_candle({ symbol, timeframe, candle })
        else this.edges[symbol].ingest_intercandle_close_update_candle({ symbol, timeframe, candle })
      }
    })

    for (let i = 0; i < market_data.length; i++) {
      let symbol = to_symbol(market_data[i])
      // not all of these will be on Binance, they just throw if missing
      try {
        let initial_candles = await this.candles_collector.get_daily_candles_between({
          symbol,
          start_date: this.start_of_bullmarket_date,
        })
        this.edges[symbol] = new Edge56({
          ee: this.ee,
          logger: this.logger,
          initial_candles,
          symbol,
          send_message: send_message_factory(`${service_name} on ${symbol}: `),
        })
        console.log(`Setup edge for ${symbol}`)
        await sleep(2000) // 1200 calls allowed per minute
      } catch (err) {
        console.info(`Unable to load candles fro ${symbol}, probably not listed on binance`)
      }
    }
  }

  shutdown_streams() {
    if (this.close_1d_candle_ws) this.close_1d_candle_ws()
    if (this.close_short_timeframe_candle_ws) this.close_short_timeframe_candle_ws()
  }
}

let edge56: Edge56Service | null
async function main() {
  assert(process.env.APIKEY)
  assert(process.env.APISECRET)
  var ee: Binance = binance({
    apiKey: process.env.APIKEY || "foo",
    apiSecret: process.env.APISECRET || "foo",
  })

  try {
    const start_of_bullmarket_date = new Date("2021-01-01")

    edge56 = new Edge56Service({
      ee,
      start_of_bullmarket_date,
      logger,
    })
    await edge56.run()
  } catch (error) {
    console.error(error)
  }
}

main().catch((error) => {
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})

function soft_exit(exit_code?: number | undefined) {
  console.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) console.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  if (edge56) edge56.shutdown_streams()
  // redis.quit()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}