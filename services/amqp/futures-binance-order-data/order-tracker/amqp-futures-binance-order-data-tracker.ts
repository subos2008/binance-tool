#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"

require("dotenv").config()

const service_name = "amqp-futures-binance-order-data-tracker"

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { SendMessage } from "../../../../classes/send_message/publish"
import { AMQP_FuturesBinanceOrderDataListener } from "../../../../classes/exchanges/binance/amqp-futures-binance-order-data-listener"
import {
  FuturesBinanceOrderData,
  FuturesOrderCallbacks,
} from "../../../../interfaces/exchanges/binance/order_callbacks"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import express from "express"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

const health_and_readiness = new HealthAndReadiness({ logger })
const send_message: SendMessageFunc = new SendMessage({ service_name, logger, health_and_readiness }).build()
const service_is_healthy = health_and_readiness.addSubsystem({
  name: "global",
  healthy: true,
  initialised: true,
})

process.on("unhandledRejection", (err) => {
  logger.error({ err })
  Sentry.captureException(err)
  send_message(`UnhandledPromiseRejection: ${err}`)
  service_is_healthy.healthy(false)
})

let order_execution_tracker: AMQP_FuturesBinanceOrderDataListener | null = null

class BinanceOrdersToSendMessageForwarder implements FuturesOrderCallbacks {
  send_message: SendMessageFunc
  logger: ServiceLogger

  constructor({ send_message, logger }: { send_message: SendMessageFunc; logger: ServiceLogger }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
  }

  async order_created(data: FuturesBinanceOrderData): Promise<void> {
    this.logger.info(data)
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let stopPrice: string = data.stopPrice ? new BigNumber(data.stopPrice).toFixed() : "(null)"

    if (data.orderType != "MARKET") {
      switch (data.orderType) {
        // Looks like STOP_LOSS_LIMIT doesn't exist on futures exchange 
        // case "STOP_LOSS_LIMIT":
        //   // if (data.isOrderWorking) {
        //   //   this.send_message(`Order triggered ${data.symbol} ${data.orderType} (edge: ${data.edge}).`)
        //   // } else {
        //   this.send_message(
        //     `Order created ${data.symbol} ${data.orderType} at ${stopPrice} to ${price} (edge: ${data.edge}).`
        //   )
        //   // }
        //   break
        default:
          this.send_message(
            `Order created ${data.orderType} ${data.side} order on ${data.symbol} at ${price} (edge: ${data.edge}).`
          )
      }
    }
  }

  async order_cancelled(data: FuturesBinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    this.send_message(
      `Order cancelled ${data.symbol} ${data.orderType} ${data.side} at ${price} (edge: ${data.edge})`
    )
  }

  async order_filled(data: FuturesBinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let averageExecutionPrice: string = data.averageExecutionPrice
      ? new BigNumber(data.averageExecutionPrice).toFixed()
      : "(null)"
    this.send_message(
      `Order filled ${data.symbol} ${data.orderType} ${data.side} at ${averageExecutionPrice} (price: ${price}) (edge: ${data.edge})`
    )
  }

  async order_expired(data: FuturesBinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let averageExecutionPrice: string = data.averageExecutionPrice
      ? new BigNumber(data.averageExecutionPrice).toFixed()
      : "(null)"
    let executedAmount = new BigNumber(data.totalTradeQuantity).isZero() ? 0 : data.totalTradeQuantity
    this.send_message(
      `Order expired ${data.symbol} ${data.orderType} ${data.side} at ${price}/${averageExecutionPrice}, executed amount ${executedAmount} (edge: ${data.edge})`
    )
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  order_execution_tracker = new AMQP_FuturesBinanceOrderDataListener({
    send_message,
    logger,
    health_and_readiness,
    order_callbacks: new BinanceOrdersToSendMessageForwarder({ logger, send_message }),
    service_name,
  })

  await order_execution_tracker.start()
}

main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
  soft_exit(1, `Error in main loop: ${err}`)
})

// Note this method returns!
function soft_exit(exit_code: number | null = null, reason: string) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.error(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}, reason: ${reason}`)
  if (exit_code) process.exitCode = exit_code
  // Sentry.close(500)
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
