#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

/**
 * Event/message listener
 */

import Sentry from "../../../lib/sentry"

import { HealthAndReadiness } from "../../health_and_readiness"
import { MyEventNameType } from "../../amqp/message-routing"
import { Channel, Message } from "amqplib"
import {
  FuturesBinanceOrderData,
  FuturesOrderCallbacks,
} from "../../../interfaces/exchanges/binance/order_callbacks"
import { SendMessageFunc } from "../../../interfaces/send-message"
import { TypedListenerFactory } from "../../amqp/listener-factory-v2"
import { ServiceLogger } from "../../../interfaces/logger"
import { TypedMessageProcessor } from "../../amqp/interfaces"

export class AMQP_FuturesBinanceOrderDataListener implements TypedMessageProcessor<FuturesBinanceOrderData> {
  send_message: Function
  logger: ServiceLogger
  health_and_readiness: HealthAndReadiness
  order_callbacks: FuturesOrderCallbacks
  print_all_trades: boolean = false
  service_name: string

  constructor({
    send_message,
    logger,
    health_and_readiness,
    order_callbacks,
    print_all_trades,
    service_name,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
    health_and_readiness: HealthAndReadiness
    order_callbacks: FuturesOrderCallbacks
    print_all_trades?: boolean
    service_name: string
  }) {
    this.logger = logger
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.order_callbacks = order_callbacks
    if (print_all_trades) this.print_all_trades = true
    this.service_name = service_name
  }

  async start() {
    try {
      await this.register_message_processors()
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err }, "Unable to start AMQP message listeners")
    }
  }

  async register_message_processors() {
    let listener_factory = new TypedListenerFactory({ logger: this.logger })
    let event_name: MyEventNameType = "FuturesBinanceOrderData"

    listener_factory.build_listener<FuturesBinanceOrderData>({
      event_name,
      message_processor: this,
      health_and_readiness: this.health_and_readiness,
      service_name: this.service_name,
      prefetch_one: false,
      eat_exceptions: false,
    })
  }

  async process_message(i: FuturesBinanceOrderData, channel: Channel, amqp_event: Message): Promise<void> {
    let tags = i
    try {
      channel.ack(amqp_event)
      this.logger.object(tags, i)
      await this.processBinanceOrderDataMessage(i)
    } catch (err: any) {
      this.logger.error({ err })
      Sentry.withScope((scope) => {
        scope.setExtra("amqp_event", amqp_event)
        Sentry.captureException(err)
      })
    }
  }

  async processBinanceOrderDataMessage(data: FuturesBinanceOrderData) {
    const { symbol, price, quantity, side, orderType, orderStatus, order_id, edge, exchange_identifier } = data

    let tags = {
      edge,
      symbol,
      order_id,
      exchange: exchange_identifier.exchange,
      exchange_type: exchange_identifier.type,
    }

    try {
      if (this.print_all_trades) {
        this.logger.info(data, `${symbol} ${side} ${orderType} ORDER #${order_id} (${orderStatus})`)
        this.logger.info(
          data,
          `..price: ${price}, quantity: ${quantity}, averageExecutionPrice: ${data.averageExecutionPrice}`
        )
      }

      if (orderStatus === "NEW") {
        if (this.order_callbacks && this.order_callbacks.order_created)
          this.order_callbacks
            .order_created(data)
            .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))
        return
      }

      if (orderStatus === "PARTIALLY_FILLED") {
        if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
          this.order_callbacks
            .order_filled_or_partially_filled(data)
            .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))
        return
      }

      if (orderStatus === "CANCELED" /*&& orderRejectReason === "NONE"*/) {
        // `Order was cancelled, presumably by user. Exiting.`, (orderRejectReason === "NONE happens when user cancelled)
        if (this.order_callbacks && this.order_callbacks.order_cancelled)
          this.order_callbacks
            .order_cancelled(data)
            .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))
        return
      }

      // EXPIRED can happen on OCO orders when the other side hits or if a token is de-listed
      // Can also happen on IOC limit buys, used to prevent slippage on entry
      if (orderStatus === "EXPIRED") {
        if (this.order_callbacks && this.order_callbacks.order_expired)
          this.order_callbacks
            .order_expired(data)
            .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))
        return
      }

      if (orderStatus !== "FILLED") {
        throw new Error(`Unexpected orderStatus: ${orderStatus}.`)
      }

      if (this.order_callbacks && this.order_callbacks.order_filled_or_partially_filled)
        this.order_callbacks
          .order_filled_or_partially_filled(data)
          .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))

      if (this.order_callbacks)
        this.order_callbacks
          .order_filled(data)
          .catch((err) => this.logger.error({ err }, `Exception leaked upwards from order_callbacks`))
    } catch (err) {
      this.logger.error(data, err)
      Sentry.withScope(function (scope) {
        scope.setTag("class", "AMQP_FuturesBinanceOrderDataListener")
        scope.setTag("operation", "processBinanceOrderDataMessage")
        scope.setTag("pair", symbol)
        if (edge) scope.setTag("edge", edge)
        if (order_id) scope.setTag("order_id", order_id)
        Sentry.captureException(err)
      })
      throw err
    }
  }
}
