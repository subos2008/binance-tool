#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const num_coins_to_monitor = 500
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge56"

import binance from "binance-api-node"
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

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { CandlesCollector } from "../../classes/utils/candle_utils"
import { Edge56EntrySignals, Edge56EntrySignalsCallbacks } from "../../classes/edges/edge56"
import { CoinGeckoAPI, CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge56Parameters, Edge56PositionEntrySignal } from "../../events/shared/edge56-position-entry"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let publisher: GenericTopicPublisher = new GenericTopicPublisher({ logger, event_name: "Edge56EntrySignal" })

const edge56_parameters: Edge56Parameters = {
  days_of_price_history: 14,
  long_highest_volume_in_days: 7,
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
    this.send_message("service re-starting")
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
    let market_data_for_symbol: CoinGeckoMarketData | undefined
    let market_data_string = ""
    try {
      market_data_for_symbol = this.market_data_for_symbol(symbol)
      market_data_string = `RANK: ${market_data_for_symbol.market_cap_rank}, MCAP: ${humanNumber(
        market_data_for_symbol.market_cap
      )}`
    } catch (e) {
      this.logger.warn(`Failed to generate market_data string for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the cap list
      Sentry.captureException(e)
    }
    try {
      let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"
      this.send_message(
        `${direction_string} entry triggered on ${symbol} at price ${entry_price.toFixed()}. Check MACD before entry. ${market_data_string}`
      )
    } catch (e) {
      this.logger.warn(`Failed to publish to telegram for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the cap list
      Sentry.captureException(e)
    }
    try {
      this.publish_entry_to_amqp({
        symbol,
        entry_price,
        direction,
        market_data_for_symbol,
      })
    } catch (e) {
      this.logger.warn(`Failed to publish to AMQP for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the cap list
      Sentry.captureException(e)
    }
  }

  publish_entry_to_amqp({
    symbol,
    entry_price,
    direction,
    market_data_for_symbol,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    market_data_for_symbol: CoinGeckoMarketData | undefined
  }) {
    let event: Edge56PositionEntrySignal = {
      version: "v1",
      market_identifier: {
        version: "v2",
        exchange_identifier: { version: "v2", exchange },
        symbol,
      },
      event_type: "Edge56EntrySignal",
      edge56_parameters,
      edge56_entry_signal: {
        direction,
        entry_price: entry_price.toFixed(),
      },
      extra: {
        CoinGeckoMarketData: market_data_for_symbol,
      },
    }
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    publisher.publish(JSON.stringify(event), options)
  }

  market_data_for_symbol(symbol: string): CoinGeckoMarketData {
    // TODO: make this replace use quote_symbol
    let usym = symbol.toUpperCase().replace(/USDT$/, "")
    let data = this.market_data.find((x) => x.symbol.toUpperCase() === usym)
    if (!data) throw new Error(`Market data for symbol ${usym} not found.`) // can happen if data updates and
    return data
  }

  async run() {
    let limit = num_coins_to_monitor
    let cg = new CoinGeckoAPI()
    // not all of these will be on Binance
    this.market_data = await cg.get_top_market_data({ limit })
    // market_data = market_data.filter((x) => x.id !== "bitcoin")
    let coin_names = this.market_data.map((x) => x.symbol.toUpperCase())
    console.log(`Top ${limit} coins by market cap: ${coin_names.join(", ")}`)
    let to_symbol = (md: CoinGeckoMarketData) => md.symbol.toUpperCase() + quote_symbol
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
          edge56_parameters,
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
    this.logger.info(`Edges initialised for ${Object.keys(this.edges).length} symbols.`)
    this.send_message(`initialised for ${Object.keys(this.edges).length} symbols.`)
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
    const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

    edge56 = new Edge56Service({
      ee,
      start_of_bullmarket_date, // TODO: this should load its own candles as it has the hardcode for 20 days history
      logger,
      send_message,
    })
    await publisher.connect()
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
