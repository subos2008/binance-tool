#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// const amqp_exchange_name = "positions"

const connect_options = require("../../lib/amqp/connect_options").default

import * as Sentry from "@sentry/node"

import { Channel, connect, Connection } from "amqplib"
import { assert } from "console"
import { Logger } from "../../interfaces/logger"
import { HealthAndReadinessSubsystem } from "../health_and_readiness"
import { MessageProcessor } from "./interfaces"
import { MessageRouting, MyEventNameType } from "./message-routing"

// A Factory / router where you give it an event type and some other shit like an exchange identifier
// and it gives you the amqp connection / queue binding that calls your callback?

// This class could also have a buddy class that
// set up and check for all the expected queues and maybe even have an admin access to RabbitMQ?

/**
 * PublisherFactory
 * ListenerFactory
 */

/**
 * What do we currently have in our routing?
 * - MyEventNameType
 * - ExchangeIdentifier
 * - exchange (AMQP exchange name)
 * - routing_keys
 *
 * */

// Prevents unhandled exceptions from MessageProcessor's
class MessageProcessorIsolator implements MessageProcessor {
  event_name: string
  message_processor: MessageProcessor
  logger: Logger

  constructor({
    event_name,
    message_processor,
    logger,
  }: {
    message_processor: MessageProcessor
    event_name: string
    logger: Logger
  }) {
    assert(event_name && message_processor && logger)
    this.event_name = event_name
    this.message_processor = message_processor
    this.logger = logger
  }
  async process_message(event: any, channel: Channel): Promise<void> {
    // TODO: sentry scope
    let Body
    try {
      Body = JSON.parse(event.content.toString())
      if (Body.object_type === this.event_name) {
        return this.message_processor.process_message(event, channel)
      } else {
        if (Body.object_type) {
          this.logger.info(`Skipping ${Body.object_type}, filtering for ${this.event_name}`)
        } else {
          let msg = `Event does not specify an object_type, it will never be processed`
          this.logger.error(msg)
          this.logger.error(Body)
          throw new Error(msg)
        }
      }
    } catch (error) {
      // Eat any exceptions to prevent this handler from affecting the process
      // Designed for having multiple independent listeners in one process
      let event_name = this.event_name
      Sentry.captureException(error, { extra: Body, tags: { event_name } })
      this.logger.warn(error)
    }
  }
}

export class ListenerFactory {
  logger: Logger
  health_and_readiness: HealthAndReadinessSubsystem | undefined

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  // isolated means it's wrapped in an exception catcher/eater
  // You might not want to await on this in case it hangs?
  async build_isolated_listener({
    event_name,
    message_processor,
    health_and_readiness,
  }: {
    message_processor: MessageProcessor
    event_name: MyEventNameType
    health_and_readiness?: HealthAndReadinessSubsystem
  }) {
    Sentry.withScope(async (scope) => {
      scope.setTag("event_name", event_name)
      // TODO: err these health_and_readiness should be internal to the listeners I think
      this.logger.warn(`health_and_readiness logic perhaps incorrect`)
      this.health_and_readiness = health_and_readiness
      try {
        assert(message_processor && event_name)
        await this.connect({
          event_name,
          message_processor: new MessageProcessorIsolator({ event_name, message_processor, logger: this.logger }),
        })
        this.health_and_readiness?.healthy(true)
        this.health_and_readiness?.ready(true)
      } catch (err) {
        this.health_and_readiness?.healthy(false)
        this.logger.error(`Error connecting MessageProcessor for event_name '${event_name}' to amqp server`)
        this.logger.error(err)
        Sentry.captureException(err)
        // throw err // don't throw when setting up isolated infrastructure
      }
    })
  }

  private async connect({
    event_name,
    message_processor,
  }: {
    message_processor: MessageProcessor
    event_name: MyEventNameType
  }) {
    // TODO: durable, exclusive, noAck, ... lots of configurable shit here...
    let { routing_key, exchange_name, exchange_type, durable } = MessageRouting.amqp_routing({ event_name })
    let connection: Connection = await connect(connect_options)
    this.logger.info(`PositionsListener: Connection with AMQP server established.`)
    let channel: Channel = await connection.createChannel() // hangs
    // TODO: do we not look at the return code here?
    await channel.assertExchange(exchange_name, exchange_type, { durable })
    const q = await channel.assertQueue("", { exclusive: true })
    channel.bindQueue(q.queue, exchange_name, routing_key)
    let wrapper_func = function (event: any) {
      message_processor.process_message(event, channel)
    }
    channel.consume(q.queue, wrapper_func, { noAck: false })
    this.logger.info(
      `ListenerFactory: Waiting for new '${event_name}' events on AMQP: exchange: ${exchange_type}:${exchange_name}, routing_key: ${routing_key}.`
    )
  }
}
