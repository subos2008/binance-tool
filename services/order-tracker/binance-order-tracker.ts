#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from "assert"

require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "order-tracker")
})

// redis + events + binance

// TODO: sentry
// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations (iirc lib around binance has been replaced)

const send_message = require("../../lib/telegram")("order-tracker: ")

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

const BinanceFoo = require("binance-api-node").default
import { Binance } from "binance-api-node"
import { OrderExecutionTracker } from "../../service_lib/order_execution_tracker"
import { BinanceOrderData } from "../../interfaces/order_callbacks"

let order_execution_tracker: OrderExecutionTracker | null = null

class MyOrderCallbacks {
  send_message: Function
  logger: Logger

  constructor({ send_message, logger }: { send_message: (msg: string) => void; logger: Logger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
  }

  async order_created(data: BinanceOrderData): Promise<void> {
    this.logger.info(data)
    if (data.orderType != "MARKET") {
      switch (data.orderType) {
        case "STOP_LOSS_LIMIT":
          this.send_message(
            `Created ${data.orderType} ${data.side} order on ${data.symbol} at ${data.stopPrice} to ${data.price}.`
          )
          break
        default:
          this.send_message(`Created ${data.orderType} ${data.side} order on ${data.symbol} at ${data.price}.`)
      }
    }
  }
  async order_cancelled(data: BinanceOrderData): Promise<void> {
    this.send_message(`${data.orderType} ${data.side} order on ${data.symbol} at ${data.price} cancelled.`)
  }
  async order_filled(data: BinanceOrderData): Promise<void> {
    this.send_message(
      `${data.orderType} ${data.side} order on ${data.symbol} filled at ${data.price}/${data.averageExecutionPrice}.`
    )
  }
}

async function main() {
  var ee: Binance
  logger.info("Live monitoring mode")
  assert(process.env.APIKEY)
  assert(process.env.APISECRET)
  ee = BinanceFoo({
    apiKey: process.env.APIKEY,
    apiSecret: process.env.APISECRET,
    // getTime: xxx // time generator function, optional, defaults to () => Date.now()
  })

  const execSync = require("child_process").execSync
  execSync("date -u")

  let order_callbacks = new MyOrderCallbacks({ logger, send_message })

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

// TODO: exceptions / sentry
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
  if (order_execution_tracker) order_execution_tracker.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
