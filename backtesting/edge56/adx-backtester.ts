// // #!./node_modules/.bin/ts-node

// // TODO:
// // Load candles - from disk or via abstraction class
// // Calculate ADX
// // Manually check agains chart - maybe check for the colour change at various points
// // Change the parameters and check it matches TradingView plots

// const Logger = require("../../lib/faux_logger")
// var logger = new Logger({ silent: false })

// require("dotenv").config()

// import BigNumber from "bignumber.js"
// BigNumber.DEBUG = true // Prevent NaN
// // Prevent type coercion
// BigNumber.prototype.valueOf = function () {
//   throw Error("BigNumber .valueOf called!")
// }

// import * as Sentry from "@sentry/node"
// Sentry.init({
//   dsn: "https://5f5398dfd6b0475ea6061cf39bc4ed03@sentry.io/5178400",
// })
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", "binance-tool")
// })

// import binance, { CancelOrderResult } from "binance-api-node"
// import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"
// import { CandlesCollector, LimitedLengthCandlesHistory, CandleUtils } from "../../classes/utils/candle_utils"

// import { assert } from "console"

// import { EntrySignals, EntrySignalsCallbacks } from "../../classes/edges/pure-adx"
// import { Logger } from "../../interfaces/logger"

// var talib = require("talib")
// console.log("TALib Version: " + talib.version)
// // // Display all available indicator function names
// // // var functions = talib.functions;
// // // for (let i in functions) {
// // // 	console.log(functions[i].name);
// // // }

// var { argv } = require("yargs").string("symbol").demand("symbol")
// let { "symbol": symbol } = argv

// logger = new Logger({ silent: false, template: { symbol } })

// process.on("unhandledRejection", (error) => {
//   logger.error(error)
// })

// class Backtester implements EntrySignalsCallbacks {
//   candles_collector: CandlesCollector
//   logger: Logger
//   ee: any
//   symbol: string
//   start_date: Date
//   start_of_algo_date: Date
//   end_date: Date

//   constructor({
//     logger,
//     ee,
//     symbol,
//     start_date,
//     start_of_algo_date,
//     end_date,
//   }: {
//     logger: Logger
//     ee: any
//     symbol: string
//     start_date: Date
//     start_of_algo_date: Date
//     end_date: Date
//   }) {
//     this.logger = logger
//     this.ee = ee
//     this.symbol = symbol
//     this.candles_collector = new CandlesCollector({ ee })
//     this.start_date = start_date
//     this.start_of_algo_date = start_of_algo_date
//     this.end_date = end_date
//   }

//   async run() {
//     let all_candles: CandleChartResult[] = await this.candles_collector.get_daily_candles_between({
//       symbol: this.symbol,
//       start_date: this.start_date,
//       end_date: this.end_date,
//     })
//     console.log(`${all_candles.length} total candles`)
//     let initial_candles = all_candles.filter((candle) => candle.closeTime < this.start_of_algo_date.getTime())
//     console.log(`${initial_candles.length} initial candles`)
//     let candles = all_candles.filter((candle) => candle.closeTime >= this.start_of_algo_date.getTime())
//     console.log(`${candles.length} candles to ingest`)

//     let entry_signals = new EntrySignals({
//       logger,
//       symbol,
//       initial_candles,
//       callbacks: this,
//     })

//     for (let i = 0; i < candles.length; i++) {
//       entry_signals.ingest_new_candle({ candle: candles[i], symbol, timeframe: "1d" })
//     }
//     // entry_signals.surmise_position()
//   }

//   // Edge56EntrySignalsCallbacks
//   in_position(): boolean {
//     return false
//   }
//   enter_position({
//     symbol,
//     entry_price,
//     direction,
//   }: {
//     symbol: string
//     entry_price: BigNumber
//     direction: "long" | "short"
//   }): void {
//     let direction_string = direction === "long" ? "⬆ LONG" : "SHORT ⬇"
//     this.logger.info(
//       "${direction_string} entry triggered on ${symbol} at price ${entry_price.toFixed()}. Check MACD before entry."
//     )
//   }
// }

// async function main(symbol: string) {
//   var ee: Binance = binance({
//     apiKey: process.env.APIKEY || "foo",
//     apiSecret: process.env.APISECRET || "foo",
//   })

//   try {
//     const start_date = new Date("2021-01-01")
//     const start_of_algo_date = new Date("2021-01-04")
//     const end_date = new Date("2021-04-01")

//     const edge = new Backtester({
//       logger,
//       ee,
//       symbol,
//       start_date,
//       start_of_algo_date,
//       end_date,
//     })

//     await edge.run()
//     soft_exit(0)
//   } catch (error) {
//     console.error(error)
//   }
// }

// // TODO: exceptions
// main(symbol).catch((error) => {
//   console.error(`Error in main loop: ${error}`)
//   console.error(error)
//   console.error(`Error in main loop: ${error.stack}`)
// })

// function soft_exit(exit_code?: number | undefined) {
//   console.warn(`soft_exit called, exit_code: ${exit_code}`)
//   if (exit_code) console.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
//   if (exit_code) process.exitCode = exit_code
//   // redis.quit()
//   // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
// }
