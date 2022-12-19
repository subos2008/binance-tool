#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

import { strict as assert } from "assert"
const service_name = "binance-execution-report-to-generic-order"

import { Binance as BinanceType, ExchangeInfo } from "binance-api-node"
import Binance from "binance-api-node"

import Sentry from "../../../../../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import { ServiceLogger } from "../../../../../../interfaces/logger"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import {
  BinanceExecutionReport,
  BinanceOrderData,
} from "../../../../../../interfaces/exchanges/binance/order_callbacks"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../../../events/shared/exchange-identifier"
import { HealthAndReadiness } from "../../../../../../classes/health_and_readiness"
import { GenericOrderData, GenericOrderUpdate } from "../../../../../../types/exchange_neutral/generic_order_data"
import {
  fromBinanceExecutionReport,
  fromCompletedBinanceOrderData,
} from "../../../../../../interfaces/exchanges/binance/spot-orders"
import { BinanceExchangeInfoGetter } from "../../../../../../classes/exchanges/binance/exchange-info-getter"
import { TypedGenericTopicPublisher } from "../../../../../../classes/amqp/typed-generic-publisher"
import { MyEventNameType } from "../../../../../../classes/amqp/message-routing"
import { TypedMessageProcessor } from "../../../../../../classes/amqp/interfaces"
import { TypedListenerFactory } from "../../../../../../classes/amqp/listener-factory-v2"
import { Channel, Message } from "amqplib"

const exchange_identifier: ExchangeIdentifier_V4 = {
  exchange: "binance",
  exchange_type: "spot",
  version: 4,
}

export class BinanceExecutionReportToGenericOrderUpdate implements TypedMessageProcessor<BinanceExecutionReport> {
  logger: ServiceLogger
  ee: BinanceType
  event_name: MyEventNameType = "BinanceExecutionReport"
  exchange_identifier: ExchangeIdentifier_V4
  health_and_readiness: HealthAndReadiness
  publisher: TypedGenericTopicPublisher<GenericOrderUpdate>
  exchange_info_getter: BinanceExchangeInfoGetter

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

    this.exchange_info_getter = new BinanceExchangeInfoGetter({ ee: this.ee })
    this.publisher = new TypedGenericTopicPublisher<GenericOrderUpdate>({
      logger,
      event_name: "GenericOrderData",
      health_and_readiness,
    })
  }

  async start() {
    await this.publisher.connect()

    let listener_factory = new TypedListenerFactory({ logger: this.logger })
    listener_factory.build_listener({
      event_name: this.event_name,
      message_processor: this,
      health_and_readiness: this.health_and_readiness,
      service_name,
      prefetch_one: true,
      eat_exceptions: false,
    })
  }

  // What about partial fills?
  // I think should should be a more raw interface - not using the callbacks interface but instead
  // mapping and sending all messages, with an alert in the mapper when it sees anything it doesn't recognise
  async process_message(data: BinanceExecutionReport, channel: Channel, raw_amqp_message: Message) {
    this.logger.info(`Binance: ${data.side} order on ${data.symbol} filled.`)
    let generic_order_update: GenericOrderUpdate = await fromBinanceExecutionReport(
      data,
      this.exchange_info_getter
    )
    const options = {
      // expiration: event_expiration_seconds,
      persistent: true,
      timestamp: Date.now(),
    }
    await this.publisher.publish(generic_order_update, options)
  }
}
