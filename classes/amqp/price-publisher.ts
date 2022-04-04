const connect_options = require("../../lib/amqp/connect_options").default

const price_data_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

const exchange = "prices"
assert(exchange)

import { connect, Connection } from "amqplib"

export class PricePublisher {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | undefined
  ee: any
  connection: Connection | undefined
  channel: any

  constructor(logger: Logger, send_message: (msg: string) => void) {
    this.logger = logger
    this.send_message = send_message
  }

  async connect() {
    try {
      // this.logger.info(`AMQP connect options:`)
      // this.logger.info(connect_options)
      this.connection = await connect(connect_options)
      this.channel = await this.connection.createChannel()
      this.channel.assertExchange(exchange, "topic", {
        durable: false,
      })
      this.logger.info(`Connection with AMQP server established.`)
    } catch (err) {
      this.logger.error(`Error connecting to amqp server`)
      this.logger.error({ err })
      Sentry.captureException(err)
      throw err
    }
  }

  async publish(event: any, routing_key: string): Promise<boolean> {
    event.routing_key = routing_key
    let msg = JSON.stringify(event)
    const options = {
      expiration: price_data_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    const server_full = await this.channel.publish(exchange, routing_key, Buffer.from(msg), options)
    return server_full
  }

  async shutdown_streams() {
    if (this.connection) this.connection.close()
  }
}
