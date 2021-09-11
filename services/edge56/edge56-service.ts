#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge56"

import binance from "binance-api-node"
import { Binance } from "binance-api-node"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const humanNumber = require("human-number")

type SendMessageFunc = (msg: string) => void

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
import { Edge56EntrySignals, Edge56EntrySignalsCallbacks } from "../../classes/edges/edge56"
import { CoinGeckoAPI, CoinGeckoMarketData } from "../../classes/utils/coin_gecko"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class Edge56Service implements Edge56EntrySignalsCallbacks {
  edges: { [Key: string]: Edge56EntrySignals } = {}
  start_of_bullmarket_date: Date
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  close_short_timeframe_candle_ws: () => void
  close_1d_candle_ws: () => void
  send_message: SendMessageFunc
  market_data: CoinGeckoMarketData[]

  constructor({
    ee,
    start_of_bullmarket_date,
    logger,
    send_message,
  }: {
    ee: Binance
    start_of_bullmarket_date: Date
    logger: Logger
    send_message: SendMessageFunc
  }) {
    this.start_of_bullmarket_date = start_of_bullmarket_date
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
  }

  // Edge56EntrySignalsCallbacks
  in_position(): boolean {
    return false
  }
  enter_position({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void {
    let market_data_string = ""
    try {
      let md = this.market_data_for_symbol(symbol)
      market_data_string = `RANK: ${md.market_cap_rank}, MCAP: ${humanNumber(md.market_cap)}`
    } catch (e) {
      this.logger.warn(`Failed to generate market_data string for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the cap list
      Sentry.captureException(e)
    }
    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"
    this.send_message(
      `${direction_string} entry triggered on ${symbol} at price ${entry_price.toFixed()}. Check MACD before entry. ${market_data_string}`
    )
  }

  market_data_for_symbol(symbol: string): CoinGeckoMarketData {
    let usym = symbol.toUpperCase()
    let data = this.market_data.find((x) => x.symbol.toUpperCase() === usym)
    if (!data) throw new Error(`Market data for symbol ${usym} not found.`) // can happen if data updates and
    return data
  }

  async run() {
    let limit = 105
    let cg = new CoinGeckoAPI()
    // not all of these will be on Binance
    this.market_data = await cg.get_top_market_data({ limit })
    // market_data = market_data.filter((x) => x.id !== "bitcoin")
    let coin_names = this.market_data.map((x) => x.symbol.toUpperCase())
    console.log(`Top ${limit} coins by market cap: ${coin_names.join(", ")}`)
    let to_symbol = (md: CoinGeckoMarketData) => md.symbol.toUpperCase() + "USDT"
    let symbols = this.market_data.map(to_symbol)

    this.close_1d_candle_ws = this.ee.ws.candles(symbols, "1d", (candle) => {
      let symbol = candle.symbol
      let timeframe = "1d"
      if (this.edges[symbol]) {
        if (candle.isFinal) {
          this.edges[symbol].ingest_new_candle({ symbol, timeframe, candle })
        }
      }
    })

    for (let i = 0; i < this.market_data.length; i++) {
      let symbol = to_symbol(this.market_data[i])
      // not all of these will be on Binance, they just throw if missing
      try {
        let initial_candles = await this.candles_collector.get_daily_candles_between({
          symbol,
          start_date: this.start_of_bullmarket_date,
        })
        if (initial_candles.length == 0) {
          console.warn(`No candles loaded for ${symbol}`)
          throw new Error(`No candles loaded for ${symbol}`)
        }
        this.edges[symbol] = new Edge56EntrySignals({
          logger: this.logger,
          initial_candles,
          symbol,
          market_data: this.market_data[i],
          callbacks: this,
        })
        console.log(`Setup edge for ${symbol}`)
        await sleep(2000) // 1200 calls allowed per minute
      } catch (err) {
        if (err.toString().includes("Invalid symbol")) {
          console.info(`Unable to load candles for ${symbol} not listed on binance`)
        } else if (err.toString().includes("No candles loaded for")) {
          console.warn(`Unable to load candles for ${symbol}.`)
        } else {
          Sentry.captureException(err)
          console.error(err)
        }
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
    const start_of_bullmarket_date = new Date("2021-05-01")

    edge56 = new Edge56Service({
      ee,
      start_of_bullmarket_date, // TODO: this should load its own candles as it has the hardcode for 20 days history
      logger,
      send_message,
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
