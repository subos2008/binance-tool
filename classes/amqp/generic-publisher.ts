const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

// const exchange = "portfolio"
// assert(exchange)

import { Channel, connect, Connection } from "amqplib"
import { Portfolio } from "../../interfaces/portfolio"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { MessageRouting } from "./message-routing"

export class GenericPublisher {
  logger: Logger
  connection: Connection
  channel: Channel
  routing_key: string
  exchange_name: string

  constructor({ logger, event_name }: { logger: Logger; event_name: string }) {
    this.logger = logger
    // we needed a routing key and this seems like a good one
    let { routing_key, exchange_name } = MessageRouting.amqp_routing({ event_name })
    this.routing_key = routing_key
    this.exchange_name = exchange_name
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
        this.channel.assertExchange(this.exchange_name, "topic", {
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

  async publish(event: string): Promise<boolean> {
    await this.connect()
    let msg = event
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    const server_full = await this.channel.publish(this.exchange_name, this.routing_key, Buffer.from(msg), options)
    if (server_full) {
      let msg = "AMQP reports server full when trying to publish portfolio"
      Sentry.captureMessage(msg, Sentry.Severity.Error)
      this.logger.error(msg)
    }
    return server_full
  }

  async shutdown_streams() {
    this.connection.close()
  }
}
