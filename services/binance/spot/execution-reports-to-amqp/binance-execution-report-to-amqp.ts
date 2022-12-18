#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"
const service_name = "binance-orders-to-amqp"

import { Binance as BinanceType, ExecutionReport } from "binance-api-node"
import Binance from "binance-api-node"

import Sentry from "../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { ServiceLogger } from "../../../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BinanceUserWSStream } from "./binance-user-ws-stream"
import {
  BinanceExecutionReport,
  ExecutionReportCallbacks,
} from "../../../../interfaces/exchanges/binance/order_callbacks"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { TypedGenericTopicPublisher } from "../../../../classes/amqp/typed-generic-publisher"

const exchange_identifier: ExchangeIdentifier_V4 = {
  exchange: "binance",
  exchange_type: "spot",
  version: 4,
}

export class BinanceExecutionReportToAMQP implements ExecutionReportCallbacks {
  logger: ServiceLogger
  ee: BinanceType
  listener: BinanceUserWSStream
  exchange_identifier: ExchangeIdentifier_V4
  health_and_readiness: HealthAndReadiness
  publisher: TypedGenericTopicPublisher<BinanceExecutionReport>

  constructor({
    send_message,
    logger,
    health_and_readiness,
  }: {
    send_message: (msg: string) => void
    logger: ServiceLogger
    health_and_readiness: HealthAndReadiness
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

    this.listener = new BinanceUserWSStream({
      ee: this.ee,
      send_message,
      logger,
      callbacks: this,
      exchange_identifier,
    })

    this.publisher = new TypedGenericTopicPublisher<BinanceExecutionReport>({
      logger,
      health_and_readiness,
      event_name: "BinanceExecutionReport",
    })
  }

  async start() {
    await this.publisher.connect()
    this.listener.main()
  }

  async process_execution_report(er: ExecutionReport): Promise<void> {
    let ber: BinanceExecutionReport = {
      ...er,
      object_type: "BinanceExecutionReport",
      version: 1,
      object_class: "event",
      exchange_identifier,
    }
    let tags = {}
    this.logger.event(tags, ber)
    await this.publisher.publish(ber)
  }
}
