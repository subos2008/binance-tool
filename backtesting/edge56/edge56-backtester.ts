// // #!./node_modules/.bin/ts-node

// // TODO:
// // Load candles - from disk or via abstraction class
// // Calculate ADX
// // Manually check agains chart - maybe check for the colour change at various points
// // Change the parameters and check it matches TradingView plots

// // const Logger = require("../../lib/faux_logger")
// // // Initial logger, we re-create it below once we have the trade_id
// // var logger = new Logger({ silent: false })
// // require("dotenv").config()
// this.candles_collector = new CandlesCollector({ ee })

// let initial_candles: CandleChartResult[]
// let price_history_candles: LimitedLengthCandlesHistory = new LimitedLengthCandlesHistory({
//   length: 20,
//   initial_candles,
//   key: this.historical_candle_key,
// })

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

// // import { Edge56 } from "../../classes/edges/edge56"

// var talib = require("talib")
// console.log("TALib Version: " + talib.version)
// // // Display all available indicator function names
// // // var functions = talib.functions;
// // // for (let i in functions) {
// // // 	console.log(functions[i].name);
// // // }

// // var { argv } = require("yargs").string("symbol").demand("symbol")
// // let { "symbol": symbol } = argv

// const logger = new Logger({ silent: false, template: { symbol } })

// process.on("unhandledRejection", (error) => {
//   logger.error(error)
// })
// class Backtester {
//   candles_collector: CandlesCollector
//   ee: any
//   start_date: Date
//   end_date: Date

//   constructor({
//     ee,
//     symbol,
//     start_date,
//     end_date,
//   }: {
//     ee: any
//     symbol: string
//     start_date: Date
//     end_date: Date
//   }) {
//     this.ee = ee
//     this.candles_collector = new CandlesCollector({ ee })
//     this.start_date = start_date
//     this.end_date = end_date
//   }

//   //   async run() {
//   //     let all_candles = await this.candles_collector.get_daily_candles_between(
//   //       this.start_date,
//   //       this.end_date)
//   //     )
//   //     console.log(`${all_candles.length} total candles`)
//   //     let initial_candles = all_candles.filter((candle) => candle.closeTime < this.start_of_algo_date.getTime())
//   //     console.log(`${initial_candles.length} initial candles`)

//   //     let candles = all_candles.filter((candle) => candle.closeTime >= this.start_of_algo_date.getTime())
//   //     console.log(`${candles.length} candles to ingest`)
//   //     for (let i = 0; i < candles.length; i++) {
//   //       this.edge.ingest_new_candle(candles[i])
//   //     }
//   //     this.edge.surmise_position()
//   //   }
// }

// async function main(symbol: string) {
//   var ee: Binance = binance({
//     apiKey: process.env.APIKEY || "foo",
//     apiSecret: process.env.APISECRET || "foo",
//   })

//   try {
//     // const start_date = new Date("2021-01-01")
//     // const start_of_algo_date = new Date("2021-04-01")

//     // TODO: surely we just pass in initial candles and ingest new candles
//     let edge = new Edge56({
//       logger,
//       ee: this.ee,
//       symbol,
//       start_date: this.start_date,
//       end_date: this.end_date,
//       initial_candles,
//     })

//     const edge = new Backtester({
//       ee,
//       symbol,
//       start_date,
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
