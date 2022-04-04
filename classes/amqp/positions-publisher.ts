const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

const exchange = "positions"
assert(exchange)

import { connect, Connection } from "amqplib"
import { NewPositionEvent } from "../../events/position-events"

export class PositionPublisher {
  logger: Logger
  send_message: (msg: string) => void
  connection: Connection | undefined
  channel: any
  broker_name: string // we needed a routing key and this seems like a good one

  constructor({
    logger,
    send_message,
    broker_name,
  }: {
    logger: Logger
    send_message: (msg: string) => void
    broker_name: string
  }) {
    this.logger = logger
    this.send_message = send_message
    this.broker_name = broker_name
  }

  async connect() {
    try {
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

  async publish_new_position_event(event: NewPositionEvent): Promise<boolean> {
    if (!this.connection) await this.connect()
    event.object_type = "NewPositionEvent"
    let msg = JSON.stringify(event)
    this.logger.object(event)
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    const routing_key = this.broker_name
    const server_full = await this.channel.publish(exchange, routing_key, Buffer.from(msg), options)
    return server_full
  }

  async shutdown_streams() {
    if (this.connection) this.connection.close()
  }
}
