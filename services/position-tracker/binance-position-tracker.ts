#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
const service_name = "binance-position-tracker"
import { fromCompletedBinanceOrderData } from "../../interfaces/exchange/binance/orders"
import { is_too_small_to_trade } from "../../lib/utils"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

const send_message = require("../../lib/telegram.js")(`${service_name}: `)

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

process.on("unhandledRejection", (error) => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`)
})

import { OrderExecutionTracker } from "../../service_lib/order_execution_tracker"
import { BinanceOrderData, OrderCallbacks } from "../../interfaces/order_callbacks"
import { PositionTracker } from "./position-tracker"

import { get_redis_client, set_redis_logger } from "../../lib/redis"
import BinanceFoo from "binance-api-node"
import { Binance } from "binance-api-node"

import { ExchangeInfo } from "binance-api-node"
set_redis_logger(logger)
const redis = get_redis_client()

let order_execution_tracker: OrderExecutionTracker | null = null

class MyOrderCallbacks implements OrderCallbacks {
  send_message: Function
  logger: Logger
  position_tracker: PositionTracker
  exchange_info: ExchangeInfo

  constructor({
    send_message,
    logger,
    position_tracker,
    exchange_info,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    position_tracker: PositionTracker
    exchange_info: ExchangeInfo
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    assert(position_tracker)
    this.position_tracker = position_tracker
    this.exchange_info = exchange_info
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    let exchange_info = this.exchange_info
    if (data.side == "BUY") {
      this.logger.info(`BUY order on ${data.symbol} filled.`)
      this.position_tracker.buy_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
    if (data.side == "SELL") {
      this.logger.info(`SELL order on ${data.symbol} filled.`)
      this.position_tracker.sell_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
  }
}

let ee: Binance
let position_tracker: PositionTracker

async function main() {
  logger.info("Live monitoring mode")
  if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
  if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
  ee = BinanceFoo({
    apiKey: process.env.APIKEY,
    apiSecret: process.env.APISECRET,
  })

  const execSync = require("child_process").execSync
  execSync("date -u")

  // return true if the position size passed it would be considered an untradeably small balance on the exchange
  let exchange_info = await ee.exchangeInfo() // TODO: should update this every now and then
  let close_position_check_func = function ({
    market_symbol,
    volume,
    price,
  }: {
    market_symbol: string
    volume: BigNumber
    price: BigNumber
  }): boolean {
    let result: boolean = is_too_small_to_trade({ symbol: market_symbol, volume, exchange_info, price })
    console.log(
      `Checking if ${volume.toFixed()} ${market_symbol} would be too small to trade (result=${
        result ? "yes" : "no"
      })`
    )
    return result
  }

  position_tracker = new PositionTracker({
    logger,
    send_message,
    redis,
    close_position_check_func,
  })

  // await publisher.connect()

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, position_tracker, exchange_info })
  order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_callbacks,
  })
  order_execution_tracker
    .main()
    .catch((error) => {
      Sentry.captureException(error)
      if (error.name && error.name === "FetchError") {
        logger.error(`${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`)
      } else {
        logger.error(`Error in main loop: ${error}`)
        logger.error(error)
        logger.error(`Error in main loop: ${error.stack}`)
        send_message(`Error in main loop: ${error}`)
      }
      soft_exit(1)
    })
    .then(() => {
      logger.info("order_execution_tracker.main() returned.")
    })
}

main().catch((error) => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`)
  logger.error(error)
  logger.error(`Error in main loop: ${error.stack}`)
  soft_exit(1)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  // if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
