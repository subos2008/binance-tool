const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

const exchange = "portfolio"
assert(exchange)

import { connect, Connection } from "amqplib"
import { Portfolio } from "../../interfaces/portfolio"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"

export class PortfolioPublisher {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | null
  connection: Connection
  channel: any
  exchange_identifier: ExchangeIdentifier
  routing_key: string

  constructor({
    logger,
    send_message,
    exchange_identifier,
  }: {
    logger: Logger
    send_message: (msg: string) => void
    exchange_identifier: ExchangeIdentifier
  }) {
    this.logger = logger
    this.send_message = send_message
    this.exchange_identifier = exchange_identifier
    // we needed a routing key and this seems like a good one
    this.routing_key = `${exchange_identifier.exchange}:${exchange_identifier.account}`
  }

  async connect() {
    try {
      if (!this.connection) {
        this.connection = await connect(connect_options)
        if (!this.connection) throw new Error(`PortfolioPublisher: this.connection is null`)
      }
      if (!this.channel) {
        this.channel = await this.connection.createChannel()
        if (!this.channel) throw new Error(`PortfolioPublisher: this.channel is null`)
        this.channel.assertExchange(exchange, "topic", {
          durable: false,
        })
        this.logger.info(`Connection with AMQP server established.`)
      }
    } catch (err) {
      this.logger.error(`Error connecting to amqp server`)
      this.logger.error(err)
      Sentry.captureException(err)
      throw err
    }
  }

  async publish(event: Portfolio): Promise<boolean> {
    await this.connect()
    // Extract only those fields we want to publish
    let trimmed_event: Portfolio = {
      usd_value: event.usd_value,
      btc_value: event.btc_value,
      balances: event.balances,
      prices: event.prices,
    }
    let msg = JSON.stringify(trimmed_event)
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    const server_full = await this.channel.publish(exchange, this.routing_key, Buffer.from(msg), options)
    if(server_full) {
      Sentry.captureMessage("AMQP reports server full when trying to publish portfolio", Sentry.Severity.Error)
    }
    return server_full
  }

  async shutdown_streams() {
    this.connection.close()
  }
}
