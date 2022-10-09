#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

const connect_options = require("../../lib/amqp/connect_options").default

import Sentry from "../../lib/sentry"

import { Channel, connect, Connection } from "amqplib"
import { assert } from "console"
import { ServiceLogger } from "../../interfaces/logger"
import { HealthAndReadinessSubsystem } from "../health_and_readiness"
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
  async process_message(raw_amqp_message: any, channel: Channel): Promise<void> {
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
    health_and_readiness: HealthAndReadinessSubsystem
    service_name: string
  }) {
    if (!health_and_readiness.healthy())
      this.logger.error({}, `health_and_readiness.healthy is false on initialisation, probably a bug`)
    Sentry.withScope(async (scope) => {
      try {
        assert(message_processor)
        await this.connect({
          health_and_readiness,
          message_processor: new MessageProcessorIsolator({
            message_processor,
            logger: this.logger,
            health_and_readiness,
          }),
        })
      } catch (err) {
        health_and_readiness.healthy(false)
        this.logger.error({ err }, `Error connecting RawAMQPMessageProcessor to amqp server`)
        Sentry.captureException(err)
        // throw err // don't throw when setting up isolated infrastructure
      }
    })
  }

  private async connect({
    message_processor,
    health_and_readiness,
  }: {
    message_processor: RawAMQPMessageProcessor
    health_and_readiness: HealthAndReadinessSubsystem
  }) {
    let exchange_name = "binance-tool"
    let exchange_type = "topic"
    // TODO: durable, exclusive, noAck, ... lots of configurable shit here...
    let { routing_key, durable } = { durable: false, routing_key: "#" } // '#' gets all messages
    let connection: Connection = await connect(connect_options)
    process.once("SIGINT", connection.close.bind(connection))
    this.logger.info(`AllTrafficTopicExchangeListener: Connection with AMQP server established.`)
    let channel: Channel = await connection.createChannel() // hangs
    let logger = this.logger
    channel.on("close", function () {
      logger.error(`AMQP Channel closed!`)
      health_and_readiness.healthy(false)
    })
    health_and_readiness.healthy(true)
    health_and_readiness.initialised(true)
    // TODO: do we not look at the return code here?
    await channel.assertExchange(exchange_name, exchange_type, { durable })
    const q = await channel.assertQueue("", { exclusive: true })
    await channel.bindQueue(q.queue, exchange_name, routing_key)
    let wrapper_func = function (event: any) {
      message_processor.process_message(event, channel)
    }
    channel.consume(q.queue, wrapper_func, { noAck: false })
    this.logger.info(
      `AllTrafficTopicExchangeListener: waiting for events on AMQP: exchange: ${exchange_type}:${exchange_name}, routing_key: ${routing_key}.`
    )
  }
}
