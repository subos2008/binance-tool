#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// const amqp_exchange_name = "positions"

const connect_options = require("../../lib/amqp/connect_options").default

import * as Sentry from "@sentry/node"

import { Channel, connect, Connection } from "amqplib"
import { assert } from "console"
import { Logger } from "../../interfaces/logger"
import { MessageProcessor } from "./interfaces"
import { MessageRouting } from "./message-routing"

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
 * - EventType
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
  async process_message(event: any): Promise<void> {
    // TODO: sentry scope
    try {
      return this.message_processor.process_message(event)
    } catch (error) {
      // Eat any exceptions to prevent this handler from affecting the process
      // Designed for having multiple independent listeners in one process
      Sentry.captureException(error)
      this.logger.warn(error)
    }
  }
}

export class ListenerFactory {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  // isolated means it's wrapped in an exception catcher/eater
  // You might not want to await on this in case it hangs?
  async build_isolated_listener({
    event_name,
    message_processor,
  }: {
    message_processor: MessageProcessor
    event_name: string
  }) {
    try {
      assert(message_processor && event_name)
      await this.connect({
        event_name,
        message_processor: new MessageProcessorIsolator({ event_name, message_processor, logger: this.logger }),
      })
    } catch (err) {
      this.logger.error(`Error connecting MessageProcessor for event_name '${event_name}' to amqp server`)
      this.logger.error(err)
      Sentry.captureException(err)
      // throw err // don't throw when setting up isolated infrastructure
    }
  }

  private async connect({
    event_name,
    message_processor,
  }: {
    message_processor: MessageProcessor
    event_name: string
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
    channel.consume(q.queue, message_processor.process_message.bind(message_processor), { noAck: false })
    this.logger.info(
      `ListenerFactory: Waiting for new '${event_name}' events on AMQP: exchange: ${exchange_type}:${exchange_name}, routing_key: ${routing_key}.`
    )
  }
}
