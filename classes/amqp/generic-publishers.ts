const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

// const exchange = "portfolio"
// assert(exchange)

import { Channel, connect, Connection, Options } from "amqplib"
import { MyEventNameType, MessageRouting } from "./message-routing"

export class GenericTopicPublisher {
  logger: Logger
  connection: Connection
  channel: Channel
  routing_key: string
  exchange_name: string
  durable: boolean

  constructor({ logger, event_name }: { logger: Logger; event_name: MyEventNameType }) {
    this.logger = logger
    // we needed a routing key and this seems like a good one
    let { routing_key, exchange_name, durable } = MessageRouting.amqp_routing({ event_name })
    this.routing_key = routing_key
    this.exchange_name = exchange_name
    this.durable = durable
    this.logger.info(
      `Publisher created for ${event_name} events to ${exchange_name} exchange with routing key ${routing_key}`
    )
  }

  async connect() {
    try {
      if (!this.connection) {
        this.connection = await connect(connect_options)
        if (!this.connection) throw new Error(`${this.constructor.name}: this.connection is null`)
      }
      if (!this.channel) {
        this.channel = await this.connection.createChannel()
        if (!this.channel) throw new Error(`${this.constructor.name}: this.channel is null`)
        await this.channel.assertExchange(this.exchange_name, "topic", {
          durable: this.durable,
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

  async publish(event: string, options?: Options.Publish): Promise<boolean> {
    await this.connect()
    let msg = event
    const server_full = !this.channel.publish(this.exchange_name, this.routing_key, Buffer.from(msg), options)
    if (server_full) {
      let msg = "AMQP reports server full when trying to publish"
      Sentry.captureMessage(msg, Sentry.Severity.Error)
      this.logger.error(msg)
      throw new Error(msg)
    }
    return server_full
  }

  async shutdown_streams() {
    this.connection.close()
  }
}
