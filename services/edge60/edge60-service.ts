#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const num_coins_to_monitor = 500
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge60"

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

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let publisher: GenericTopicPublisher = new GenericTopicPublisher({ logger, event_name: "Edge60EntrySignal" })

const edge60_parameters: Edge60Parameters = {
  days_of_price_history: 22,
}

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
    this.send_message("service re-starting")
    this.direction_persistance = direction_persistance
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
    let base_asset = this.base_asset_for_symbol(symbol)
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
    let previous_direction = await this.direction_persistance.get_direction(base_asset)
    this.direction_persistance.set_direction(base_asset, direction)
    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"

    if (previous_direction === null) {
      this.send_message(
        `possible ${direction_string} entry signal on ${symbol} - check manually if this is a trend reversal.`
      )
      return
    }

    let direction_change = previous_direction && previous_direction != direction
    let entry_filter = direction_change
    if (entry_filter) {
      try {
        let days = edge60_parameters.days_of_price_history
        let msg = `trend reverasl ${direction_string} entry signal on ${symbol} at ${days}d price ${entry_price.toFixed()}. ${market_data_string}`
        this.logger.info({ signal: "entry", direction, symbol }, msg)
        this.send_message(msg)
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
          previous_direction,
          market_data_for_symbol,
        })
      } catch (e) {
        this.logger.warn(`Failed to publish to AMQP for ${symbol}`)
        // This can happen if top 100 changes since boot and we refresh the cap list
        Sentry.captureException(e)
      }
    } else {
      this.logger.info(`${symbol} ${direction} price triggered but not trend reversal`)
    }
  }

  publish_entry_to_amqp({
    symbol,
    entry_price,
    direction,
    previous_direction,
    market_data_for_symbol,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
    previous_direction: "long" | "short"
    market_data_for_symbol: CoinGeckoMarketData | undefined
  }) {
    let event: Edge60PositionEntrySignal = {
      version: "v1",
      edge: "edge60",
      market_identifier: {
        version: "v3",
        // TODO: pull exchange_identifier from ee
        exchange_identifier: { version: "v3", exchange, type: "spot", account: "default" },
        symbol,
        base_asset: this.base_asset_for_symbol(symbol),
      },
      object_type: "Edge60EntrySignal",
      edge60_parameters,
      edge60_entry_signal: {
        direction,
        entry_price: entry_price.toFixed(),
      },
      extra: {
        previous_direction,
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

  base_asset_for_symbol(symbol: string): string {
    let copy = symbol.repeat(1)
    let base_asset = copy.toUpperCase().replace(new RegExp(`(USDT|${quote_symbol})$`), "")
    return base_asset
  }

  market_data_for_symbol(symbol: string): CoinGeckoMarketData {
    let usym = this.base_asset_for_symbol(symbol)
    if (!this.market_data) throw new Error(`Market data not initialised.`) // can happen if data updates and
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

    let required_initial_candles = Edge60EntrySignals.required_initial_candles(edge60_parameters)
    for (let i = 0; i < this.market_data.length; i++) {
      let symbol = to_symbol(this.market_data[i])
      // not all of these will be on Binance, they just throw if missing
      try {
        // Last N closed weekly candles exist between N+1 weeks ago and now
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
          console.warn(`No candles loaded for ${symbol}`)
          throw new Error(`No candles loaded for ${symbol}`)
        }
        this.edges[symbol] = new Edge60EntrySignals({
          logger: this.logger,
          initial_candles,
          symbol,
          market_data: this.market_data[i],
          callbacks: this,
          edge60_parameters,
        })
        console.log(`Setup edge for ${symbol} with ${initial_candles.length} initial candles`)
        await sleep(2000) // 1200 calls allowed per minute
      } catch (err: any) {
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
    let valid_symbols = Object.keys(this.edges)
    this.logger.info(`Edges initialised for ${valid_symbols.length} symbols.`)
    this.send_message(`initialised for ${valid_symbols.length} symbols.`)

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

    edge60 = new Edge60Service({
      ee,
      logger,
      send_message,
      direction_persistance: new DirectionPersistance({
        logger,
        prefix: `${service_name}:spot:binance:usd_quote`,
        send_message,
      }),
    })
    await publisher.connect()
    await edge60.run()
  } catch (error) {
    console.error(error)
    Sentry.captureException(error)
  }
}

main().catch((error) => {
  Sentry.captureException(error)
  console.error(`Error in main loop: ${error}`)
  console.error(error)
  console.error(`Error in main loop: ${error.stack}`)
})
