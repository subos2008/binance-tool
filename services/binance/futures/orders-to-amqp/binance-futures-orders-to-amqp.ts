import { strict as assert } from "assert"
const service_name = "binance-orders-to-amqp"

import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { HealthAndReadinessSubsystem } from "../../../../classes/health_and_readiness"
import { RedisClient } from "redis"
import { RedisOrderContextPersistance } from "../../../../classes/spot/persistence/redis-implementation/redis-order-context-persistence"
import { BinanceOrderPublisher } from "../../lib/binance-order-publisher"
import { OrderExecutionTracker } from "../../../../classes/exchanges/binance/order_execution_tracker"

export class BinanceFuturesOrdersToAMQP {
  logger: Logger
  ee: BinanceType
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier_V3
  health_and_readiness: HealthAndReadinessSubsystem
  publisher: BinanceOrderPublisher

  constructor({
    send_message,
    logger,
    health_and_readiness,
    redis,
    exchange_identifier,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    health_and_readiness: HealthAndReadinessSubsystem
    redis: RedisClient
    exchange_identifier: ExchangeIdentifier_V3
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.health_and_readiness = health_and_readiness
    this.exchange_identifier = exchange_identifier
    if (!process.env.BINANCE_API_KEY) throw new Error(`Missing BINANCE_API_KEY in ENV`)
    if (!process.env.BINANCE_API_SECRET) throw new Error(`Missing BINANCE_API_SECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.BINANCE_API_KEY,
      apiSecret: process.env.BINANCE_API_SECRET,
    })
    let order_context_persistence = new RedisOrderContextPersistance({ logger, redis })

    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee,
      send_message,
      logger,
      order_callbacks: this,
      order_context_persistence,
      exchange_identifier,
    })

    this.publisher = new BinanceOrderPublisher({
      logger,
      health_and_readiness,
    })
  }

  async start() {
    await this.publisher.connect()
    this.order_execution_tracker.main()
  }

  // What about partial fills?
  // I think should should be a more raw interface - not using the callbacks interface but instead
  // mapping and sending all messages, with an alert in the mapper when it sees anything it doesn't recognise
  async order_filled(data: BinanceOrderData): Promise<void> {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    await this.publisher.publish(data)
  }
}
