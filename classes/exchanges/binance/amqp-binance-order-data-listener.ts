#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

/**
 * Event/message listener
 */

import Sentry from "../../../lib/sentry"

import { MessageProcessor } from "../../amqp/interfaces"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../health_and_readiness"
import { MyEventNameType } from "../../amqp/message-routing"
import { Channel } from "amqplib"
import { OrderCallbacks, BinanceOrderData } from "../../../interfaces/exchanges/binance/order_callbacks"
import { SendMessageFunc } from "../../../interfaces/send-message"
import { ServiceLogger } from "../../../interfaces/logger"
import { TypedListenerFactory } from "../../amqp/listener-factory-v2"

export class AMQP_BinanceOrderDataListener implements MessageProcessor {
  event_name: MyEventNameType = "BinanceOrderData"
  send_message: Function
  logger: ServiceLogger
  health_and_readiness: HealthAndReadiness
  callbacks_health: HealthAndReadinessSubsystem
  order_callbacks: OrderCallbacks
  print_all_trades: boolean = false
  service_name: string | undefined

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
    order_callbacks: OrderCallbacks
    print_all_trades?: boolean
    service_name?: string
  }) {
    this.logger = logger
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.order_callbacks = order_callbacks
    if (print_all_trades) this.print_all_trades = true
    this.service_name = service_name
    // Added this so we can set unhealthy if the message callbacks throw
    // This will mean we don't ACK the message anyway so going unhealthy
    // here just brings down the message ACK timeout kill
    this.callbacks_health = this.health_and_readiness.addSubsystem({
      name: `${this.event_name}_Callbacks`,
      ready: true,
      healthy: true, // Go unhealthy if we get exceptions from the callbacks
    })
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
    listener_factory.build_listener({
      event_name: this.event_name,
      message_processor: this,
      health_and_readiness: this.health_and_readiness,
      service_name: this.service_name,
      prefetch_one: true,
      eat_exceptions: false,
    })
  }

  async process_message(amqp_event: any, channel: Channel): Promise<void> {
    try {
      let i: BinanceOrderData = JSON.parse(amqp_event.content.toString())
      await this.processBinanceOrderDataMessage(i)
      channel.ack(amqp_event)
    } catch (err: any) {
      err.amqp_event = amqp_event
      this.logger.exception({}, err)
      Sentry.captureException(err, { extra: amqp_event })
      this.callbacks_health.healthy(false)
    }
  }

  async processBinanceOrderDataMessage(data: BinanceOrderData) {
    const { symbol, price, quantity, side, orderType, orderStatus, order_id, exchange_identifier } = data

    let tags = {
      symbol,
      order_id,
      exchange: exchange_identifier.exchange,
      exchange_type: exchange_identifier.type,
    }

    try {
      if (this.print_all_trades) {
        data.msg = `${symbol} ${side} ${orderType} ORDER #${order_id} (${orderStatus})`
        this.logger.event(tags, data)
        this.logger.info(
          tags,
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
        throw new Error(`Unexpected orderStatus: ${orderStatus}. Reason: ${data.orderRejectReason}`)
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
        scope.setTag("class", "AMQP_BinanceOrderDataListener")
        scope.setTag("operation", "processBinanceOrderDataMessage")
        scope.setTag("pair", symbol)
        if (order_id) scope.setTag("order_id", order_id)
        Sentry.captureException(err)
      })
      throw err
    }
  }
}
