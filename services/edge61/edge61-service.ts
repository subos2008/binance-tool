#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/** Config: */
const num_coins_to_monitor = 500
const quote_symbol = "USDT".toUpperCase()

import { strict as assert } from "assert"
require("dotenv").config()
const service_name = "edge61"

import binance, { ExchangeInfo } from "binance-api-node"
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
import { Edge61EntrySignals, LongShortEntrySignalsCallbacks } from "../../classes/edges/edge61"
import { Edge61Parameters, Edge61PositionEntrySignal } from "../../events/shared/edge61-position-entry"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { config } from "../../config"

process.on("unhandledRejection", (error) => {
  logger.error(error)
  Sentry.captureException(error)
  const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()
  send_message(`UnhandledPromiseRejection: ${error}`)
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let publisher: GenericTopicPublisher = new GenericTopicPublisher({ logger, event_name: "Edge61EntrySignal" })

const edge61_parameters: Edge61Parameters = {
  days_of_price_history: 22,
}

class Edge61Service implements LongShortEntrySignalsCallbacks {
  edges: { [Key: string]: Edge61EntrySignals } = {}
  candles_collector: CandlesCollector
  ee: Binance
  logger: Logger
  close_short_timeframe_candle_ws: (() => void) | undefined
  close_1d_candle_ws: (() => void) | undefined
  send_message: SendMessageFunc
  market_data: CoinGeckoMarketData[] | undefined
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor({ ee, logger, send_message }: { ee: Binance; logger: Logger; send_message: SendMessageFunc }) {
    this.candles_collector = new CandlesCollector({ ee })
    this.ee = ee
    this.logger = logger
    this.send_message = send_message
    this.send_message("service re-starting")
    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
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
    let base_asset: string = await this.base_asset_for_symbol(symbol)
    let market_data_for_symbol: CoinGeckoMarketData | undefined
    let market_data_string = ""

    try {
      market_data_for_symbol = await this.market_data_for_symbol(symbol)
      if (market_data_for_symbol) {
        market_data_string = `RANK: ${market_data_for_symbol.market_cap_rank}, MCAP: ${humanNumber(
          market_data_for_symbol.market_cap
        )}`
      }
    } catch (e) {
      // This can happen
      this.logger.warn(`Failed to generate market_data string for ${symbol}`)
      Sentry.captureException(e)
    }
    let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"

    try {
      let days = edge61_parameters.days_of_price_history
      let msg = `trend reversal ${direction_string} entry signal on ${symbol} at ${days}d price ${entry_price.toFixed()}. ${market_data_string}`
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
        market_data_for_symbol,
      })
    } catch (e) {
      this.logger.warn(`Failed to publish to AMQP for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the cap list
      Sentry.captureException(e)
    }
  }

  async publish_entry_to_amqp({
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
    let event: Edge61PositionEntrySignal = {
      version: "v1",
      edge: "edge61",
      market_identifier: {
        version: "v3",
        // TODO: pull exchange_identifier from ee
        exchange_identifier: { version: "v3", exchange, type: "spot", account: "default" },
        symbol,
        base_asset: await this.base_asset_for_symbol(symbol),
      },
      object_type: "Edge61EntrySignal",
      edge61_parameters,
      edge61_entry_signal: {
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
    publisher.publish(event, options)
  }

  async base_asset_for_symbol(symbol: string): Promise<string> {
    let exchange_info = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols
    let match = symbols.find((s) => s.symbol === symbol)
    if (!match) throw new Error(`No match for symbol ${symbol} in exchange_info symbols`)
    return match.baseAsset
  }

  async market_data_for_symbol(symbol: string): Promise<CoinGeckoMarketData | undefined> {
    let usym = await this.base_asset_for_symbol(symbol)
    if (!this.market_data) throw new Error(`Market data not initialised.`) // can happen if data updates and
    let data = this.market_data.find((x) => x.symbol.toUpperCase() === usym)
    // if (!data) throw new Error(`Market data for symbol ${usym} not found.`) // can happen if data updates and
    return data
  }

  /**
   * Returns base_assets that are available on both the quote the TAS is using (not USDT because it's a scam)
   * and the quote the Algo uses (USDT because it's mot liquid) */
  async get_base_assets_list(signals_quote_asset: string): Promise<string[]> {
    let tas_quote_asset = config.tas_quote_asset.toUpperCase()
    let exchange_info: ExchangeInfo = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols.filter((s) => s.isSpotTradingAllowed && s.status === "TRADING")
    this.logger.info(`${symbols.length} spot tradeable symbols on Binance`)
    symbols = symbols.filter((s) => s.baseAssetPrecision === 8 && s.quoteAssetPrecision === 8)
    this.logger.info(`${symbols.length} of those assets have a precision of 8`)

    let signal_assets = new Set(
      symbols.filter((s) => s.quoteAsset === signals_quote_asset).map((s) => s.baseAsset)
    )
    this.logger.info(`${signal_assets.size} base_assets on Binance available on signals ${signals_quote_asset}`)
    let tas_assets = new Set(symbols.filter((s) => s.quoteAsset === tas_quote_asset).map((s) => s.baseAsset))
    this.logger.info(`${tas_assets.size} base_assets on Binance available on signals ${tas_quote_asset}`)

    /** compute intersection */
    let target_assets = new Set<string>()
    for (var x of signal_assets) if (tas_assets.has(x)) target_assets.add(x)

    let targets: string[] = Array.from(target_assets)
    this.logger.info(
      `${targets.length} base_assets on Binance available on both ${signals_quote_asset} and ${tas_quote_asset}`
    )
    return targets
  }

  async run() {
    /** New world demo */
    let base_assets: string[] = await this.get_base_assets_list(quote_symbol)
    this.logger.info(`V2 target markets: ${base_assets.join(", ")}`)

    let limit = num_coins_to_monitor
    let cg = new CoinGeckoAPI()
    // not all of these will be on Binance
    this.market_data = await cg.get_top_market_data({ limit })
    let to_symbol = (base_asset: string) => base_asset.toUpperCase() + quote_symbol
    let required_initial_candles = Edge61EntrySignals.required_initial_candles(edge61_parameters)
    for (let i = 0; i < base_assets.length; i++) {
      let symbol = to_symbol(base_assets[i])
      // not all of these will be on Binance, they just throw if missing
      try {
        // Last N closed candles exist between N+1 ago and now (actually and midnight last night)
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
          this.logger.error(`No candles loaded for ${symbol}`)
          let error = new Error(`No candles loaded for ${symbol}`)
          Sentry.captureException(error) // this is unexpected now, 429?
          throw error
        }

        // chop off the most recent candle as the code above gives us a partial candle at the end
        if (initial_candles[initial_candles.length - 1].closeTime > Date.now()) {
          let partial_candle = initial_candles.pop()
          if (partial_candle) assert(partial_candle.closeTime > Date.now()) // double check that was actually a partial candle
        }

        this.edges[symbol] = new Edge61EntrySignals({
          logger: this.logger,
          initial_candles,
          symbol,
          market_data: this.market_data[i],
          callbacks: this,
          edge61_parameters,
        })
        this.logger.info(`Setup edge for ${symbol} with ${initial_candles.length} initial candles`)
        await sleep(200) // 1200 calls allowed per minute per IP address
      } catch (err: any) {
        Sentry.captureException(err)
        this.logger.error(err)
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

let edge61: Edge61Service | null
async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  var ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })

  try {
    const send_message: SendMessageFunc = new SendMessage({ service_name, logger }).build()

    edge61 = new Edge61Service({
      ee,
      logger,
      send_message,
    })
    await publisher.connect()
    await edge61.run()
  } catch (error) {
    logger.error(error)
    Sentry.captureException(error)
  }
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
})
