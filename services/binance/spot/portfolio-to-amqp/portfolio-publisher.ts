#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * BinancePortfolioToAMQP implements PortfolioBitchClass
 *
 * callbacks on OrderExecutionTracker.
 *
 * order_filled callback calls update_portfolio_from_exchange that updates price and portfolio data
 * in the master. I think the master might then callback into the publisher to fire the event.
 *
 * TODO: MasterPortfolioClass was I think an attempt at having one shared master portfolio
 * updated by multiple exchange connected classes. Perhaps we could mimic that and
 * have exchange specific events be collated by a master portfolio tracker that then
 * sends out a master portfolio updated event, merging all exchanges positions.
 *
 */

// TODO: health_and_readiness isn't great here. Healthy() can be called from multiple places in the code, one true could overwrite another (false)

// (OLD) TODO:
// 1. Take initial portfolio code from the position sizer
// 3. Maintain portfolio state - probably just in-process

import { strict as assert } from "assert"
const service_name = "binance-portfolio-to-amqp"
const event_expiration_seconds = "60"

import { MasterPortfolioClass, PortfolioBitchClass } from "./interfaces"
import { Binance as BinanceType } from "binance-api-node"
import Binance from "binance-api-node"

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

import { OrderExecutionTracker } from "../../../../classes/exchanges/binance/spot-order-execution-tracker"
import { BinanceOrderData } from "../../../../interfaces/exchanges/binance/order_callbacks"
import { ExchangeIdentifier, ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Balance, Portfolio, SpotPortfolio } from "../../../../interfaces/portfolio"

import { PortfolioUtils } from "../../../../classes/utils/portfolio-utils"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../../../classes/health_and_readiness"
import { RedisClient } from "redis"
import { RedisOrderContextPersistance } from "../../../../classes/persistent_state/redis-implementation/redis-order-context-persistence"
import { SendMessageFunc } from "../../../../lib/telegram-v2"

// Let's keep this code, could become part of ensuring same format events accross exchanges
export class PortfolioPublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  connection: Connection | undefined
  channel: any
  pub: GenericTopicPublisher
  event_name: MyEventNameType
  health_and_readiness: HealthAndReadinessSubsystem
  exchange_identifier: ExchangeIdentifier_V3

  constructor({
    logger,
    event_name,
    health_and_readiness,
    exchange_identifier,
  }: {
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadinessSubsystem
    exchange_identifier: ExchangeIdentifier_V3
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.event_name = event_name
    this.exchange_identifier = exchange_identifier
    this.pub = new GenericTopicPublisher({ logger, event_name })
  }

  async connect(): Promise<void> {
    try {
      await this.pub.connect()
    } catch (err) {
      this.logger.error({ err, msg: `Failed to connect to AMQP in PortfolioPublisher` })
      Sentry.captureException(err)
      this.health_and_readiness.ready(false)
      throw err
    }
    this.health_and_readiness.ready(true)
    this.health_and_readiness.healthy(true)
  }

  async publish(event: Portfolio): Promise<void> {
    // Extract only those fields we want to publish
    let trimmed_event: SpotPortfolio = {
      object_type: "SpotPortfolio",
      version: 1,
      exchange_identifier: this.exchange_identifier,
      timestamp_ms: Date.now(),
      usd_value: event.usd_value,
      btc_value: event.btc_value,
      balances: event.balances,
      prices: event.prices,
    }
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    try {
      await this.pub.publish(trimmed_event, options)
    } catch (e) {
      this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
    this.health_and_readiness.healthy(false)
  }
}


