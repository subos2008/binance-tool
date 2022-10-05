const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import Sentry from "../../lib/sentry"

// const exchange = "portfolio"
// assert(exchange)

import { Channel, connect, Connection, Options } from "amqplib"
import { MyEventNameType, MessageRouting } from "./message-routing"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../../classes/health_and_readiness"

export interface PublishableObject {
  object_type: string // rounting will fail if this is not provided - used to be called event_name
}

export class GenericTopicPublisher {
  logger: Logger
  connection: Connection | undefined
  channel: Channel | undefined
  routing_key: string
  exchange_name: string
  durable: boolean
  health_and_readiness: HealthAndReadinessSubsystem
  prefix: string

  constructor({
    logger,
    event_name,
    health_and_readiness,
  }: {
    logger: Logger
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadiness
  }) {
    this.logger = logger
    let { routing_key, exchange_name, durable } = MessageRouting.amqp_routing({ event_name })
    this.routing_key = routing_key
    this.exchange_name = exchange_name
    this.durable = durable
    this.prefix = `AMQP Publisher ${exchange_name}-${routing_key}-${event_name}`
    this.health_and_readiness = health_and_readiness.addSubsystem({
      name: `AMQP-Publisher-${exchange_name}-${routing_key}-${event_name}`,
      ready: false, // wait till the publishers are healthy before the service accepts traffic
      healthy: true, // set false if we have any server connection problems
    })
  }

  async connect() {
    try {
      if (!this.connection) {
        this.connection = await connect(connect_options)
        if (!this.connection) throw new Error(`${this.constructor.name}: this.connection is null`)
      }
      if (!this.channel) {
        this.channel = await this.connection.createChannel()
        // TODO: why are we not calling channel.connect()
        let connection_closed = (err: any) => {
          this.logger.error(`${this.prefix}: connection problems, setting unhealthy: ${err}`)
          this.health_and_readiness.ready(false)
          this.health_and_readiness.healthy(false)
        }
        this.channel.on("close", connection_closed)
        this.channel.on("error", connection_closed)
        if (!this.channel) throw new Error(`${this.constructor.name}: this.channel is null`)
        await this.channel.assertExchange(this.exchange_name, "topic", {
          durable: this.durable,
        })
        this.logger.info(`Connection with AMQP server established.`)
        this.health_and_readiness.ready(true)
      }
    } catch (err: any) {
      this.logger.error(`${this.prefix} error connecting to amqp server: ${err.message}`)
      this.logger.error({ err })
      Sentry.captureException(err)
      this.health_and_readiness.ready(false)
      this.health_and_readiness.healthy(false)
      throw err
    }
  }

  async publish(event: PublishableObject, options?: Options.Publish): Promise<boolean> {
    try {
      await this.connect()
      let msg = JSON.stringify(event)
      if (!this.channel) throw new Error("not connected to channel when publish() called")

      const server_full = !this.channel.publish(this.exchange_name, this.routing_key, Buffer.from(msg), options)
      if (server_full) {
        let msg = "AMQP reports server full when trying to publish"
        Sentry.captureMessage(msg, Sentry.Severity.Error)
        this.logger.error(msg)
        throw new Error(msg)
      }
      return server_full
    } catch (err) {
      Sentry.captureException(err)
      this.health_and_readiness.ready(false)
      this.health_and_readiness.healthy(false)
      throw err
    }
  }

  async shutdown_streams() {
    this.logger.warn(`shutdown_streams called`)
    // Waiting for a channel close is basically a flush
    if (this.channel) {
      await this.channel.close()
      this.channel = undefined
    }
    if (this.connection) {
      await this.connection.close()
      this.connection = undefined
    }
    this.health_and_readiness.ready(false)
    this.health_and_readiness.healthy(false)
  }
}
