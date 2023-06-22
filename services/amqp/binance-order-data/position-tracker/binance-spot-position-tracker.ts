#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"
const service_name = "binance-position-tracker"
import { fromCompletedBinanceOrderData } from "../../../../interfaces/exchanges/binance/spot-orders"

require("dotenv").config()

let account = "default"

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

import express from "express"
import binance, { Binance, ExchangeInfo } from "binance-api-node"
import { BinanceOrderData, OrderCallbacks } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { SpotPositionTracker } from "./position-tracker"
import { SpotPositionsPersistence } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { RedisSpotPositionsPersistence } from "../../../../classes/spot/persistence/redis-implementation/redis-spot-positions-persistance-v3"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { AMQP_BinanceOrderDataListener } from "../../../../classes/exchanges/binance/amqp-binance-order-data-listener"
import { BinanceExchangeInfoGetter } from "../../../../classes/exchanges/binance/exchange-info-getter"
import { SendMessage } from "../../../../classes/send_message/publish"
import { get_redis_client } from "../../../../lib/redis-v4"
import { SendMessageFunc } from "../../../../interfaces/send-message"
import { SpotPositionPublisher } from "./spot-position-publisher"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BunyanServiceLogger } from "../../../../lib/service-logger"
import { OrderContext_V1 } from "../../../../interfaces/orders/order-context"
import { RedisOrderContextPersistence } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { OrderContextPersistence } from "../../../../classes/persistent_state/interface/order-context-persistence"
import { TooSmallToTrade } from "../../../../interfaces/exchanges/generic/too_small_to_trade"
import { BinanceAlgoUtils } from "../../../binance/spot/trade-abstraction-v2/execution/execution_engines/_internal/binance_algo_utils_v2"

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

let order_execution_tracker: AMQP_BinanceOrderDataListener | null = null

class MyOrderCallbacks implements OrderCallbacks {
  send_message: SendMessageFunc
  logger: ServiceLogger
  position_tracker: SpotPositionTracker
  exchange_info: ExchangeInfo
  order_context_persistence: OrderContextPersistence

  constructor({
    send_message,
    logger,
    position_tracker,
    exchange_info,
    order_context_persistence,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    position_tracker: SpotPositionTracker
    exchange_info: ExchangeInfo
    order_context_persistence: OrderContextPersistence
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    assert(position_tracker)
    this.position_tracker = position_tracker
    this.logger.todo({}, `Using static exchange_info in position tracker`)
    this.exchange_info = exchange_info
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

  async order_filled(data: BinanceOrderData): Promise<void> {
    let { side, symbol } = data
    let { edge } = await this.get_order_context_for_order(data)
    let tags = { edge, side, symbol }

    let exchange_info = this.exchange_info
    if (data.side == "BUY") {
      data.msg = `BUY order on ${data.symbol} filled (edge: ${edge}).`
      this.logger.object(tags, data)
      await this.position_tracker.buy_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
    if (data.side == "SELL") {
      data.msg = `SELL order on ${data.symbol} filled (edge: ${edge}).`
      this.logger.object(tags, data)
      await this.position_tracker.sell_order_filled({
        generic_order_data: fromCompletedBinanceOrderData(data, exchange_info),
      })
    }
  }
}

let position_tracker: SpotPositionTracker

async function main() {
  assert(process.env.BINANCE_API_KEY)
  assert(process.env.BINANCE_API_SECRET)
  const ee: Binance = binance({
    apiKey: process.env.BINANCE_API_KEY || "foo",
    apiSecret: process.env.BINANCE_API_SECRET || "foo",
  })
  const exchange_info_getter = new BinanceExchangeInfoGetter({ ee })
  let exchange_info = await exchange_info_getter.get_exchange_info() // TODO: should update this every now and then
  let exchange_identifier = exchange_info_getter.get_exchange_identifier()
  let too_small_to_trade: TooSmallToTrade = new BinanceAlgoUtils({ logger, ee, exchange_info_getter })

  const redis = await get_redis_client(logger, health_and_readiness)
  const spot_positions_persistance: SpotPositionsPersistence = new RedisSpotPositionsPersistence({ logger, redis })
  const spot_positions_query = new SpotPositionsQuery({
    logger,
    positions_persistance: spot_positions_persistance,
    send_message,
    exchange_identifier,
  })

  let spot_position_publisher = new SpotPositionPublisher({
    logger,
    health_and_readiness: health_and_readiness,
  })
  await spot_position_publisher.connect()

  position_tracker = new SpotPositionTracker({
    logger,
    send_message,
    redis,
    close_position_checker: too_small_to_trade,
    spot_positions_query,
    spot_positions_persistance,
    callbacks: spot_position_publisher,
    health_and_readiness,
  })

  let order_context_persistence = new RedisOrderContextPersistence({ logger, redis })

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({
    logger,
    send_message,
    position_tracker,
    exchange_info,
    order_context_persistence,
  })
  order_execution_tracker = new AMQP_BinanceOrderDataListener({
    send_message,
    logger,
    health_and_readiness,
    service_name,
    order_callbacks,
  })

  await order_execution_tracker.start()
}

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
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`)
  if (exit_code) process.exitCode = exit_code
  // if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

var app = express()
app.get("/health", health_and_readiness.health_handler.bind(health_and_readiness))
const port = "80"
app.listen(port)
logger.info(`Server on port ${port}`)
