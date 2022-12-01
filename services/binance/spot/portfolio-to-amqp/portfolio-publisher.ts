#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

const service_name = "binance-portfolio-to-amqp"
const event_expiration_seconds = "60"

import Sentry from "../../../../lib/sentry"
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

import { Connection } from "amqplib"
import { GenericTopicPublisher } from "../../../../classes/amqp/generic-publishers"
import { MyEventNameType } from "../../../../classes/amqp/message-routing"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Portfolio, SpotPortfolio } from "../../../../interfaces/portfolio"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"

// Let's keep this code, could become part of ensuring same format events accross exchanges
export class PortfolioPublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  connection: Connection | undefined
  channel: any
  pub: GenericTopicPublisher
  event_name: MyEventNameType
  exchange_identifier: ExchangeIdentifier_V3

  constructor({
    logger,
    event_name,
    health_and_readiness,
    exchange_identifier,
  }: {
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadiness
    exchange_identifier: ExchangeIdentifier_V3
  }) {
    this.logger = logger
    this.event_name = event_name
    this.exchange_identifier = exchange_identifier
    this.pub = new GenericTopicPublisher({ logger, event_name, health_and_readiness })
  }

  async connect(): Promise<void> {
    return this.pub.connect()
  }

  async publish(event: SpotPortfolio): Promise<void> {
    // Extract only those fields we want to publish
    let trimmed_event: SpotPortfolio = {
      object_type: "SpotPortfolio",
      version: 1,
      exchange_identifier: this.exchange_identifier,
      timestamp_ms: Date.now(),
      usd_value: event.usd_value,
      balances: event.balances,
      prices: event.prices,
    }
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    await this.pub.publish(trimmed_event, options)
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}
