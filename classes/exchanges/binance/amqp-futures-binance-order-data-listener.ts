#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import * as Sentry from "@sentry/node"
Sentry.init({})

import { ListenerFactory } from "../../amqp/listener-factory"
import { Logger } from "../../../lib/faux_logger"
import { MessageProcessor } from "../../amqp/interfaces"
import { HealthAndReadiness } from "../../health_and_readiness"
import { MyEventNameType } from "../../amqp/message-routing"
import { Channel } from "amqplib"
import { FuturesBinanceOrderData, FuturesOrderCallbacks } from "../../../interfaces/exchanges/binance/order_callbacks"
import { SendMessageFunc } from "../../../lib/telegram-v2"

export class AMQP_FuturesBinanceOrderDataListener implements MessageProcessor {
  send_message: Function
  logger: Logger
  health_and_readiness: HealthAndReadiness
  order_callbacks: FuturesOrderCallbacks
  print_all_trades: boolean = false

  constructor({
    send_message,
    logger,
    health_and_readiness,
    order_callbacks,
    print_all_trades,
  }: {
    send_message: SendMessageFunc
    logger: Logger
    health_and_readiness: HealthAndReadiness
    order_callbacks: FuturesOrderCallbacks
    print_all_trades?: boolean
  }) {
    this.logger = logger
    this.send_message = send_message
    this.health_and_readiness = health_and_readiness
    this.order_callbacks = order_callbacks
    if (print_all_trades) this.print_all_trades = true
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
    let listener_factory = new ListenerFactory({ logger: this.logger })
    let event_name: MyEventNameType = "FuturesBinanceOrderData"
    let health_and_readiness = this.health_and_readiness.addSubsystem({
      name: event_name,
      ready: false,
      healthy: false,
    })
    listener_factory.build_isolated_listener({
      event_name,
      message_processor: this,
      health_and_readiness,
    })
  }

  async process_message(amqp_event: any, channel: Channel): Promise<void> {
    try {
      channel.ack(amqp_event)
      let i: FuturesBinanceOrderData = JSON.parse(amqp_event.content.toString())
      this.logger.info(i)
      await this.processBinanceOrderDataMessage(i)
    } catch (err: any) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }

  async processBinanceOrderDataMessage(data: FuturesBinanceOrderData) {
    const {
      symbol,
      price,
      quantity,
      side,
      orderType,
      orderStatus,
      order_id,
      edge,
      exchange_identifier,
    } = data

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
