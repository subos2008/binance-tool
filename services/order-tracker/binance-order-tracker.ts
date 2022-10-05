#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"

require("dotenv").config()

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "order-tracker")
})

const service_name = "order-tracker"

import { get_redis_client, set_redis_logger } from "../../lib/redis"
const BinanceFoo = require("binance-api-node").default
import { Binance } from "binance-api-node"
import { OrderExecutionTracker } from "../binance/spot/orders-to-amqp/spot-order-execution-tracker"
import { BinanceOrderData } from "../../interfaces/exchanges/binance/order_callbacks"
import { RedisOrderContextPersistence } from "../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { HealthAndReadiness } from "../../classes/health_and_readiness"
import { SendMessage } from "../../classes/send_message/publish"
import { SendMessageFunc } from "../../interfaces/send-message"
import express from "express"

// redis + events + binance

// TODO: sentry
// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations (iirc lib around binance has been replaced)

import { BigNumber } from "bignumber.js"
import { OrderContextPersistence } from "../../classes/persistent_state/interface/order-context-persistence"
import { OrderContext_V1 } from "../../interfaces/orders/order-context"
import { ServiceLogger } from "../../interfaces/logger"
import { BunyanServiceLogger } from "../../lib/service-logger"

BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_type: "ServiceStarting" })

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

class MyOrderCallbacks {
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
    this.logger.event({}, data)
    let { edge } = await this.get_order_context_for_order(data)
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let stopPrice: string = data.stopPrice ? new BigNumber(data.stopPrice).toFixed() : "(null)"

    if (data.orderType != "MARKET") {
      switch (data.orderType) {
        case "STOP_LOSS_LIMIT":
          if (data.isOrderWorking) {
            this.send_message(`Triggered ${data.symbol} ${data.orderType} (edge: ${edge}).`)
          } else {
            this.send_message(
              `Created ${data.symbol} ${data.orderType} at ${stopPrice} to ${price} (edge: ${edge}).`
            )
          }
          break
        default:
          this.send_message(
            `Created ${data.orderType} ${data.side} order on ${data.symbol} at ${price} (edge: ${edge}).`
          )
      }
    }
  }

  async order_cancelled(data: BinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let { edge } = await this.get_order_context_for_order(data)
    this.send_message(`${data.symbol} ${data.orderType} ${data.side} at ${price} cancelled  (edge: ${edge})`)
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    let price: string = data.price ? new BigNumber(data.price).toFixed() : "(null)"
    let averageExecutionPrice: string = data.averageExecutionPrice
      ? new BigNumber(data.averageExecutionPrice).toFixed()
      : "(null)"
    let { edge } = await this.get_order_context_for_order(data)
    this.send_message(
      `${data.symbol} ${data.orderType} ${data.side} filled at ${price}/${averageExecutionPrice}  (edge: ${edge})`
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
      `${data.symbol} ${data.orderType} ${data.side} EXPIRED at ${price}/${averageExecutionPrice}, executed amount ${executedAmount} (edge: ${edge})`
    )
  }
}

async function main() {
  var ee: Binance
  logger.info("Live monitoring mode")
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  ee = BinanceFoo({
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    // getTime: xxx // time generator function, optional, defaults to () => Date.now()
  })

  const execSync = require("child_process").execSync
  execSync("date -u")

  set_redis_logger(logger)
  let redis = get_redis_client()

  let order_context_persistence = new RedisOrderContextPersistence({ logger, redis })
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, order_context_persistence })

  let spot_order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_callbacks,
    exchange_identifier: { type: "spot", version: "v3", exchange: "binance", account: "default" },
  })

  spot_order_execution_tracker.main().catch((err: any) => {
    Sentry.captureException(err)
    logger.error({ err })
    soft_exit(1)
  })
}

// TODO: exceptions / sentry
main().catch((err) => {
  Sentry.captureException(err)
  logger.error(`Error in main loop: ${err}`)
  logger.error({ err })
  logger.error(`Error in main loop: ${err.stack}`)
  soft_exit(1)
})

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  service_is_healthy.healthy(false) // it seems service isn't exiting on soft exit, but add this to make sure
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
