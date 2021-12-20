#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * somewhere we need a service that knows if we are in a position so it diferentiates between
 * adding to position vs opening a position and moves the stops
 *
 * Test: new listing with less than 2 weeks of price history
 * - don't enter or set stops on massive candles - but we can add to position on them? Add this to doc and ask M.
 */

/** Config: */
const num_coins_to_monitor = 500
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge58"

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

import { SendMessage, SendMessageFunc } from "../../lib/telegram-v2"
const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { CandlesCollector } from "../../classes/utils/candle_utils"
import { Edge58EntrySignals, Edge58EntrySignalsCallbacks } from "../../classes/edges/edge58"
import { CoinGeckoAPI, CoinGeckoMarketData } from "../../classes/utils/coin_gecko"
import { Edge58Parameters, Edge58EntrySignal } from "../../events/shared/edge58-position-entry"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let publisher: GenericTopicPublisher = new GenericTopicPublisher({ logger, event_name: "Edge58EntrySignal" })

const edge58_parameters: Edge58Parameters = {
  candles_of_price_history: 2,
  candle_timeframe: "1w",
}

class Edge58Service implements Edge58EntrySignalsCallbacks {
  edges: { [Key: string]: Edge58EntrySignals } = {}
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  close_short_timeframe_candle_ws: () => void
  close_candle_ws: () => void
  send_message: SendMessageFunc
  market_data: CoinGeckoMarketData[]

  constructor({ ee, logger, send_message }: { ee: Binance; logger: Logger; send_message: SendMessageFunc }) {
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting")
  }

  enter_or_add_to_position({
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
        `${direction_string} entry triggered on ${symbol} at price ${entry_price.toFixed()}. before entry check: ADX, entry candle <35%. ${market_data_string}`
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
    let event: Edge58EntrySignal = {
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
      extra: {
        CoinGeckoMarketData: market_data_for_symbol,
      },
    }
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(), // TODO: maybe this should be set to the candle close timestamp
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

    let timeframe = edge58_parameters.candle_timeframe
    this.close_candle_ws = this.ee.ws.candles(symbols, timeframe, (candle) => {
      let symbol = candle.symbol
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
        // Last N closed weekly candles exist between N+1 weeks ago and now
        let start_date = new Date()
        let end_date = new Date(start_date)
        start_date.setDate(start_date.getDate() + (edge58_parameters.candles_of_price_history + 1) * 7)
        let initial_candles = await this.candles_collector.get_candles_between({
          timeframe,
          symbol,
          start_date,
          end_date,
        })
        if (initial_candles.length == 0) {
          // prob just means not listed on Binance
          this.logger.info(`No candles loaded for ${symbol}`)
          throw new Error(`No candles loaded for ${symbol}`)
        }
        if (initial_candles.length > edge58_parameters.candles_of_price_history) {
          // we must have picked up some partial candles
          this.logger.error(`Wrong number of candles for ${symbol}`)
          throw new Error(`Wrong number of candles for ${symbol}`)
        }
        this.edges[symbol] = new Edge58EntrySignals({
          logger: this.logger,
          initial_candles,
          symbol,
          callbacks: this,
          edge58_parameters,
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
    if (this.close_candle_ws) this.close_candle_ws()
    if (this.close_short_timeframe_candle_ws) this.close_short_timeframe_candle_ws()
  }
}

let edge58: Edge58Service | null
async function main() {
  assert(process.env.APIKEY)
  assert(process.env.APISECRET)
  var ee: Binance = binance({
    apiKey: process.env.APIKEY || "foo",
    apiSecret: process.env.APISECRET || "foo",
  })

  try {
    edge58 = new Edge58Service({
      ee,
      logger,
      send_message,
    })
    await publisher.connect()
    await edge58.run()
  } catch (error) {
    console.error(error)
  }
}

main().catch((error) => {
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})