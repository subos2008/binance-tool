#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

// const amqp_exchange_name = "positions"

const connect_options = require("../../lib/amqp/connect_options").default

import Sentry from "../../lib/sentry"

import { Channel, connect, Connection, Message } from "amqplib"
import { assert } from "console"
import { ServiceLogger } from "../../interfaces/logger"
import { HealthAndReadinessSubsystem } from "../health_and_readiness"
import { RawAMQPMessageProcessor, TypedMessageProcessor } from "./interfaces"
import { MessageRouting, MyEventNameType } from "./message-routing"
import { ContextTags } from "../../interfaces/send-message"

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
class TypedMessageProcessorWrapper<EventT> implements RawAMQPMessageProcessor {
  event_name: string
  message_processor: TypedMessageProcessor<EventT>
  logger: ServiceLogger
  health_and_readiness: HealthAndReadinessSubsystem
  /* eat_exceptions: eat any exceptions the callback message_processor throws */
  eat_exceptions: boolean

  constructor({
    event_name,
    message_processor,
    logger,
    health_and_readiness,
    eat_exceptions,
  }: {
    message_processor: TypedMessageProcessor<EventT>
    event_name: string
    logger: ServiceLogger
    health_and_readiness: HealthAndReadinessSubsystem
    eat_exceptions: boolean
  }) {
    assert(event_name && message_processor && logger)
    this.event_name = event_name
    this.message_processor = message_processor
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.eat_exceptions = eat_exceptions
  }

  /* Called by amqplib to deliver a new event */
  async process_message(raw_amqp_message: Message, channel: Channel): Promise<void> {
    // TODO: sentry scope
    let raw_body = raw_amqp_message.content.toString()
    let Body
    let tags = raw_amqp_message.fields as ContextTags
    try {
      try {
        Body = JSON.parse(raw_body)
      } catch (err) {
        // Eat and log any messages that are badly formed JSON
        let event_name = this.event_name
        Sentry.captureException(err, { extra: { raw_body }, tags: { event_name } })
        this.logger.exception(tags, err)
        channel.nack(raw_amqp_message) // stop re-delivery of badly formed messages NACK
      }
      if (Body.object_type === this.event_name) {
        return this.message_processor.process_message(Body, channel, raw_amqp_message)
      } else {
        if (Body.object_type) {
          this.logger.info(`Skipping ${Body.object_type}, filtering for ${this.event_name}`)
          channel.ack(raw_amqp_message) // If we don't ack here the channel will be closed by the server
        } else {
          channel.nack(raw_amqp_message) // If we don't ack here the channel will be closed by the server
          let msg = `Event does not specify an object_type, it will never be processed`
          let error_event = { object_type: "InvalidSendMessage", msg, Body }
          this.logger.event(tags, error_event)
          this.logger.error(tags, msg)
        }
      }
    } catch (err) {
      // Eat any exceptions to prevent this handler from affecting the process
      // Designed for having multiple independent listeners in one process
      let event_name = this.event_name
      Sentry.captureException(err, { extra: { raw_body, Body }, tags: { event_name } })
      this.logger.exception(tags, err)
      if (!this.eat_exceptions) throw err
    }
  }
}

export class TypedListenerFactory {
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
  }

  // isolated means it's wrapped in an exception catcher/eater
  // You might not want to await on this in case it hangs?
  async build_listener<EventT>({
    event_name,
    message_processor,
    health_and_readiness,
    service_name,
    prefetch_one,
    eat_exceptions,
  }: {
    message_processor: TypedMessageProcessor<EventT>
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadinessSubsystem
    service_name?: string
    prefetch_one: boolean
    eat_exceptions: boolean
  }) {
    Sentry.withScope(async (scope) => {
      scope.setTag("event_name", event_name)
      try {
        assert(message_processor && event_name)
        await this.connect({
          event_name,
          queue_name: event_name + "-" + service_name,
          health_and_readiness,
          message_processor: new TypedMessageProcessorWrapper<EventT>({
            event_name,
            message_processor,
            logger: this.logger,
            health_and_readiness,
            eat_exceptions,
          }),
          prefetch_one,
        })
      } catch (err) {
        health_and_readiness.healthy(false)
        this.logger.exception(
          {},
          err,
          `Error connecting MessageProcessor for event_name '${event_name}' to amqp server`
        )
        Sentry.captureException(err)
        // throw err // don't throw when setting up isolated infrastructure
      }
    })
  }

  private async connect<EventT>({
    event_name,
    message_processor,
    health_and_readiness,
    // does message routing have queue_name_prefix?
    queue_name,
    prefetch_one,
  }: {
    message_processor: RawAMQPMessageProcessor
    event_name: MyEventNameType
    health_and_readiness: HealthAndReadinessSubsystem
    queue_name?: string
    prefetch_one: boolean
  }) {
    if (!health_and_readiness.healthy()) {
      throw new Error(`Likely bug - initialise healthy to true`)
    }
    // TODO: durable, exclusive, noAck, ... lots of configurable shit here...
    let { routing_key, exchange_name, exchange_type, durable } = MessageRouting.amqp_routing({ event_name })
    let connection: Connection = await connect(connect_options)
    process.once("SIGINT", connection.close.bind(connection))
    this.logger.info(`ListenerFactory: Connection with AMQP server established.`)
    let channel: Channel = await connection.createChannel() // hangs
    let logger = this.logger
    channel.on("close", function () {
      logger.error(`AMQP Channel closed!`)
      health_and_readiness.healthy(false)
    })
    health_and_readiness.ready(true)
    // TODO: do we not look at the return code here?
    // TODO: I think maybe asserting the channel, queue, exchange shound be on every message
    await channel.assertExchange(exchange_name, exchange_type, { durable })
    let exclusive: boolean
    if (queue_name) {
      exclusive = false
    } else {
      exclusive = true
      queue_name = ""
    }
    const q = await channel.assertQueue(queue_name, { exclusive })
    if (prefetch_one) channel.prefetch(1) // things rate limiting by witholding ACKs will need this
    await channel.bindQueue(q.queue, exchange_name, routing_key)
    let wrapper_func = function (event: any) {
      message_processor.process_message(event, channel)
    }
    channel.consume(q.queue, wrapper_func, { noAck: false })
    this.logger.info(
      `ListenerFactory: Waiting for new '${event_name}' events on AMQP: exchange: ${exchange_type}:${exchange_name}, routing_key: ${routing_key}, service_name "${queue_name}"`
    )
  }
}
