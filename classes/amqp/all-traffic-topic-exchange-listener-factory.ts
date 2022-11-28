#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

const connect_options = require("../../lib/amqp/connect_options").default

import Sentry from "../../lib/sentry"

import { Channel, connect, Connection, Message } from "amqplib"
import { assert } from "console"
import { ServiceLogger } from "../../interfaces/logger"
import { HealthAndReadiness, HealthAndReadinessSubsystem } from "../health_and_readiness"
import { RawAMQPMessageProcessor } from "./interfaces"

// Prevents unhandled exceptions from RawAMQPMessageProcessor's
class MessageProcessorIsolator implements RawAMQPMessageProcessor {
  message_processor: RawAMQPMessageProcessor
  logger: ServiceLogger
  health_and_readiness: HealthAndReadinessSubsystem

  constructor({
    message_processor,
    logger,
    health_and_readiness,
  }: {
    message_processor: RawAMQPMessageProcessor
    logger: ServiceLogger
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    assert(message_processor && logger)
    this.message_processor = message_processor
    this.logger = logger
    this.health_and_readiness = health_and_readiness
  }
  async process_message(raw_amqp_message: Message, channel: Channel): Promise<void> {
    // TODO: sentry scope
    let Body
    try {
      Body = JSON.parse(raw_amqp_message.content.toString())
      return this.message_processor.process_message(raw_amqp_message, channel)
    } catch (err) {
      // Eat any exceptions to prevent this handler from affecting the process
      // Designed for having multiple independent listeners in one process
      Sentry.captureException(err, { extra: Body })
      this.logger.warn({ err })
    }
  }
}

export class AllTrafficTopicExchangeListenerFactory {
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
  }

  // isolated means it's wrapped in an exception catcher/eater
  // You might not want to await on this in case it hangs?
  async build_isolated_listener({
    message_processor,
    health_and_readiness,
    service_name,
  }: {
    message_processor: RawAMQPMessageProcessor
    health_and_readiness: HealthAndReadiness
    service_name: string
  }) {
    if (!health_and_readiness.healthy())
      this.logger.error({}, `health_and_readiness.healthy is false on initialisation, probably a bug`)
    Sentry.withScope(async (scope) => {
      let exchange_name = "binance-tool"
      let exchange_type = "topic"
      let headers = { "x-queue-type": "quorum" },
        durable = false,
        routing_key = "#", // '#' gets all messages
        prefetch_one = true

      let listener_health = health_and_readiness.addSubsystem({
        name: `AMQP-Listener-${exchange_name}-all-events`,
        healthy: true,
        initialised: false,
      })

      try {
        let wrapped_message_processor = new MessageProcessorIsolator({
          message_processor,
          logger: this.logger,
          health_and_readiness: listener_health,
        })

        let connection: Connection = await connect(connect_options)
        process.once("SIGINT", connection.close.bind(connection))
        this.logger.info(`AllTrafficTopicExchangeListener: Connection with AMQP server established.`)
        let channel: Channel = await connection.createChannel() // hangs
        let logger = this.logger
        channel.on("close", function () {
          logger.error(`AMQP Channel closed!`)
          listener_health.healthy(false)
        })

        await channel.assertExchange(exchange_name, exchange_type, { durable })

        let queue_name = `All-Events-${service_name}`
        const q = await channel.assertQueue(queue_name, { exclusive: false, arguments: headers })
        if (prefetch_one) channel.prefetch(1) // things rate limiting by witholding ACKs will need this

        await channel.bindQueue(q.queue, exchange_name, routing_key)
        let wrapper_func = function (event: Message | null) {
          if (event === null) {
            // null means server closed the channel
            listener_health.healthy(false)
            throw new Error(`AMQP server closed the connection`) // actually this might be just a RabbitMQ thing
          }
          wrapped_message_processor.process_message(event, channel)
        }
        channel.consume(q.queue, wrapper_func, { noAck: false })
        this.logger.info(
          `AllTrafficTopicExchangeListener: waiting for events on AMQP: exchange: ${exchange_type}:${exchange_name}, routing_key: ${routing_key}.`
        )
        listener_health.initialised(true)

        let obj = {
          object_type: "AMQPListenerStarted",
          object_class: "event" as "event",
          exchange_type,
          exchange_name,
          routing_key,
          queue_name,
          headers,
          msg: `AllTrafficTopicExchangeListenerFactory: Waiting for all events`,
        }
        this.logger.event({}, obj)
      } catch (err) {
        this.logger.exception(
          {},
          err,
          `Error connecting AllTrafficTopicExchangeListenerFactory (listener) to amqp server`
        )
        Sentry.captureException(err)
        listener_health.healthy(false)
        throw err
      }
    })
  }
}
