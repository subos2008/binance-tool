#!./node_modules/.bin/ts-node
/* eslint-disable no-console */


const service_name = "binance-orders-to-amqp"

import Sentry from "../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { Logger } from "../../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { FuturesBinanceOrderData } from "../../../interfaces/exchanges/binance/order_callbacks"
import { GenericTopicPublisher } from "../../../classes/amqp/generic-publishers"
import { HealthAndReadiness } from "../../../classes/health_and_readiness"
import { MyEventNameType } from "../../../classes/amqp/message-routing"
import { Connection } from "amqplib"

export class BinanceFuturesOrderDataPublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  connection: Connection | undefined
  channel: any
  pub: GenericTopicPublisher
  event_name: MyEventNameType = "FuturesBinanceOrderData"
  health_and_readiness: HealthAndReadiness

  constructor({ logger, health_and_readiness }: { logger: Logger; health_and_readiness: HealthAndReadiness }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.pub = new GenericTopicPublisher({ logger, event_name: this.event_name, health_and_readiness })
  }

  async connect(): Promise<void> {
    await this.pub.connect()
  }

  async publish(event: FuturesBinanceOrderData): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    await this.pub.publish(event, options)
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}
