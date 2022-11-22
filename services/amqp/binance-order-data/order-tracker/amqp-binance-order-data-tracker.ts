#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"

require("dotenv").config()

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "order-tracker")
})

const service_name = "amqp-binance-order-data-tracker"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BunyanServiceLogger } from "../../../../lib/service-logger"
import { OrderContext_V1 } from "../../../../interfaces/orders/order-context"
import { RedisOrderContextPersistence } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { OrderContextPersistence } from "../../../../classes/persistent_state/interface/order-context-persistence"
import { ServiceLogger } from "../../../../interfaces/logger"
import { SendMessage } from "../../../../classes/send_message/publish"
import { AMQP_BinanceOrderDataListener } from "../../../../classes/exchanges/binance/amqp-binance-order-data-listener"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import express from "express"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import { get_redis_client } from "../../../../lib/redis-v4"

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting", msg: "Service starting" })

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

let order_execution_tracker: AMQP_BinanceOrderDataListener | null = null
class BinanceOrdersToSendMessageForwarder {
  send_message: SendMessageFunc
  logger: ServiceLogger
  order_context_persistence: OrderContextPersistence

  constructor({
    send_message,
    logger,
    order_context_persistence,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    order_context_persistence: OrderContextPersistence
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.order_context_persistence = order_context_persistence
  }

  async get_order_context_for_order(data: BinanceOrderData): Promise<OrderContext_V1 | { edge: undefined }> {
    let order_context: OrderContext_V1 | undefined = undefined
    try {
      order_context = await this.order_context_persistence.get_order_context_for_order({
        exchange_identifier: data.exchange_identifier,
        order_id: data.order_id,
      })
    } catch (err) {
      // Non fatal there are valid times for this like manually created orders
      this.logger.exception(data, err)
    }
    return order_context || { edge: undefined }
  }

  async order_created(data: BinanceOrderData): Promise<void> {
    this.logger.info(data)
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let stopPrice: string = data.stopPrice ? new BigNumber(data.stopPrice).toFixed() : "(null)"

    let { edge } = await this.get_order_context_for_order(data)

    if (data.orderType != "MARKET") {
      switch (data.orderType) {
        case "STOP_LOSS_LIMIT":
          if (data.isOrderWorking) {
            this.send_message(`Order triggered ${data.symbol} ${data.orderType} (edge: ${edge}).`)
          } else {
            this.send_message(
              `Order created ${data.symbol} ${data.orderType} at ${stopPrice} to ${price} (edge: ${edge}).`
            )
          }
          break
        default:
          this.send_message(
            `Order created ${data.orderType} ${data.side} order on ${data.symbol} at ${price} (edge: ${edge}).`
          )
      }
    }
  }

  async order_cancelled(data: BinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let { edge } = await this.get_order_context_for_order(data)
    this.send_message(`Order cancelled ${data.symbol} ${data.orderType} ${data.side} at ${price} (edge: ${edge})`)
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let averageExecutionPrice: string = data.averageExecutionPrice
      ? new BigNumber(data.averageExecutionPrice).toFixed()
      : "(null)"
    let { edge } = await this.get_order_context_for_order(data)
    this.send_message(
      `Order filled ${data.symbol} ${data.orderType} ${data.side} at ${averageExecutionPrice} (price: ${price}) (edge: ${edge})`
    )
  }

  async order_expired(data: BinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let averageExecutionPrice: string = data.averageExecutionPrice
      ? new BigNumber(data.averageExecutionPrice).toFixed()
      : "(null)"
    let executedAmount = new BigNumber(data.totalTradeQuantity).isZero() ? 0 : data.totalTradeQuantity
    let { edge } = await this.get_order_context_for_order(data)
    this.send_message(
      `Order expired ${data.symbol} ${data.orderType} ${data.side} at ${price}/${averageExecutionPrice}, executed amount ${executedAmount} (edge: ${edge})`
    )
  }
}

async function main() {
  const execSync = require("child_process").execSync
  execSync("date -u")

  let redis = await get_redis_client(logger, health_and_readiness)
  let order_context_persistence = new RedisOrderContextPersistence({ logger, redis })

  order_execution_tracker = new AMQP_BinanceOrderDataListener({
    send_message,
    logger,
    health_and_readiness,
    service_name,
    order_callbacks: new BinanceOrdersToSendMessageForwarder({ logger, send_message, order_context_persistence }),
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
