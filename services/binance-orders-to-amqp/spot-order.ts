#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from "assert"
const service_name = "binance-to-amqp"

import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { OrderExecutionTracker } from "../../classes/exchanges/binance/order_execution_tracker"
import { BinanceOrderData } from "../../interfaces/order_callbacks"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { GenericTopicPublisher } from "../../classes/amqp/generic-publishers"
import { HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"
import { MyEventNameType } from "../../classes/amqp/message-routing"
import { Connection } from "amqplib"

const exchange_identifier = { exchange: "binance", account: "default" }

export class BinanceOrderPublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  connection: Connection | undefined
  channel: any
  pub: GenericTopicPublisher
  event_name: MyEventNameType
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    logger,
    event_name,
    health_and_readiness,
  }: {
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.event_name = event_name
    this.pub = new GenericTopicPublisher({ logger, event_name })
  }

  async connect(): Promise<void> {
    await this.pub.connect()
    this.health_and_readiness.ready(true)
  }

  async publish(event: BinanceOrderData): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    try {
      await this.pub.publish(JSON.stringify(event), options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}

export class BinanceSpotOrdersToAMQP {
  logger: Logger
  ee: BinanceType
  order_execution_tracker: OrderExecutionTracker
  exchange_identifier: ExchangeIdentifier
  health_and_readiness: HealthAndReadinessSubsystem
  publisher: BinanceOrderPublisher

  constructor({
    send_message,
    logger,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.health_and_readiness = health_and_readiness
    this.exchange_identifier = exchange_identifier
    if (!process.env.APIKEY) throw new Error(`Missing APIKEY in ENV`)
    if (!process.env.APISECRET) throw new Error(`Missing APISECRET in ENV`)
    this.ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET,
    })
    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee,
      send_message,
      logger,
      order_callbacks: this,
    })

    this.publisher = new BinanceOrderPublisher({
      logger,
      event_name: "SpotBinanceOrder",
      health_and_readiness,
    })
  }

  async start() {
    await this.publisher.connect()
    this.order_execution_tracker.main()
  }

  async order_filled(data: BinanceOrderData): Promise<void> {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    await this.publisher.publish(data)
  }
}
