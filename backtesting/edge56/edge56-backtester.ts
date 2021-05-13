// #!./node_modules/.bin/ts-node

// const Logger = require("../../lib/faux_logger")
// // Initial logger, we re-create it below once we have the trade_id
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

// // import { get_redis_client, set_redis_logger } from "../../lib/redis"
// // set_redis_logger(logger)
// // const redis = get_redis_client()

// // const { promisify } = require("util")
// // const hgetallAsync = promisify(redis.hgetall).bind(redis)
// import binance, { CancelOrderResult } from "binance-api-node"
// import { Binance, CandleChartInterval, CandleChartResult } from "binance-api-node"
// import { threadId } from "worker_threads"
// import { assert } from "console"

// import { Edge56 } from "../../classes/edges/edge56"

// // var talib = require('talib');
// // console.log("TALib Version: " + talib.version);
// // Display all available indicator function names
// // var functions = talib.functions;
// // for (let i in functions) {
// // 	console.log(functions[i].name);
// // }

// var { argv } = require("yargs").string("symbol").demand("symbol")
// let { "symbol": symbol } = argv

// logger = new Logger({ silent: false, template: { symbol } })

// process.on("unhandledRejection", (error) => {
//   logger.error(error)
// })

// import { CandlesCollector, CandleUtils } from "../../classes/utils/candle_utils"

// class Edge56Backtester {
//   edge: Edge56
//   start_of_bullmarket_date: Date
//   start_of_algo_date: Date
//   end_of_algo_date: Date
//   candles_collector: CandlesCollector
//   ee: any

//   constructor({
//     ee,
//     symbol,
//     start_of_bullmarket_date,
//     start_of_algo_date,
//     end_of_algo_date,
//   }: {
//     ee: any
//     symbol: string
//     start_of_bullmarket_date: Date
//     start_of_algo_date: Date
//     end_of_algo_date: Date
//   }) {
//     this.start_of_bullmarket_date = start_of_bullmarket_date
//     this.start_of_algo_date = start_of_algo_date
//     this.end_of_algo_date = end_of_algo_date
//     this.candles_collector = new CandlesCollector({ ee, symbol, start_date: start_of_bullmarket_date })
//     this.ee = ee
//   }

//   async run() {
//     let all_candles = await this.candles_collector.get_daily_candles_between(
//       this.start_of_bullmarket_date,
//       new Date()
//     )
//     console.log(`${all_candles.length} total candles`)
//     let initial_candles = all_candles.filter((candle) => candle.closeTime < this.start_of_algo_date.getTime())
//     console.log(`${initial_candles.length} initial candles`)

//     this.edge = new Edge56({
//       logger,
//       ee: this.ee,
//       symbol,
//       start_of_bullmarket_date: this.start_of_bullmarket_date,
//       end_of_algo_date: this.end_of_algo_date,
//       initial_candles,
//     })

//     let candles = all_candles.filter((candle) => candle.closeTime >= this.start_of_algo_date.getTime())
//     console.log(`${candles.length} candles to ingest`)
//     for (let i = 0; i < candles.length; i++) {
//       this.edge.ingest_new_candle(candles[i])
//     }
//     this.edge.surmise_position()
//   }
// }

// async function main(symbol: string) {
//   var ee: Binance = binance({
//     apiKey: process.env.APIKEY || "foo",
//     apiSecret: process.env.APISECRET || "foo",
//   })

//   try {
//     const start_of_bullmarket_date = new Date("2021-01-01")
//     const start_of_algo_date = new Date("2021-04-01")

//     const edge56 = new Edge56Backtester({
//       ee,
//       start_of_bullmarket_date,
//       start_of_algo_date,
//       end_of_algo_date: new Date(),
//       symbol,
//     })
//     await edge56.run()
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
