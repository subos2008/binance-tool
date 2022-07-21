#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/**
 * Event/message listener
 */

import * as Sentry from "@sentry/node"
Sentry.init({})

import { Logger } from "../../../lib/faux_logger"
import { Channel, Message } from "amqplib"

import { SendMessageFunc } from "../../../classes/send_message/publish"
import { SendMessageEvent } from "../../../classes/send_message/publish"
import { MyEventNameType } from "../../../classes/amqp/message-routing"
import { ListenerFactory } from "../../../classes/amqp/listener-factory"
import { HealthAndReadiness } from "../../../classes/health_and_readiness"
import { MessageProcessor } from "../../../classes/amqp/interfaces"

export interface SendMessageCallback {
  processSendMessageEvent(event: SendMessageEvent, ack_func: () => void): Promise<void>
}

//let foo :SendMessageEvent = { "object_type":"SendMessage", "service_name": "ryan_test", "msg": "Hello World!", "tags": {}}

export class AMQP_SendMessageListener implements MessageProcessor {
  logger: Logger
  health_and_readiness: HealthAndReadiness
  callback: SendMessageCallback
  service_name: string | undefined

  constructor({
    logger,
    health_and_readiness,
    callback,
    service_name,
  }: {
    logger: Logger
    health_and_readiness: HealthAndReadiness
    callback: SendMessageCallback
    service_name?: string
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.callback = callback
    this.service_name = service_name
  }

  async start() {
    try {
      await this.register_message_processors()
    } catch (err) {
      Sentry.captureException(err)
      this.logger.error({ err }, "Unable to start AMQP message listeners")
    }
  }

  async register_message_processors() {
    let listener_factory = new ListenerFactory({ logger: this.logger })
    let event_name: MyEventNameType = "SendMessage"
    let health_and_readiness = this.health_and_readiness.addSubsystem({
      name: event_name,
      ready: false,
      healthy: false,
    })
    listener_factory.build_isolated_listener({
      event_name,
      message_processor: this,
      health_and_readiness,
      service_name: this.service_name,
      prefetch_one: true
    })
  }

  async process_message(amqp_message: Message, channel: Channel): Promise<void> {
    // Warning: the isolated listener has similar code
    try {
      this.logger.info(amqp_message.content.toString())
      let i: SendMessageEvent | undefined
      try {
        i = JSON.parse(amqp_message.content.toString()) as SendMessageEvent
        this.logger.info(i)
        i.msg = `B ${i.msg}`
      } catch (err) {
        // Couldn't parse message as JSON - eat it
        // Actually, the MessageIsolator will do this probably before we get here
        this.logger.error({ err })
        this.logger.error(
          `Unable to parse incomming AMQP message content as JSON: ${amqp_message.content.toString()}`
        )
        this.logger.error(amqp_message)
        channel.nack(amqp_message) // nack
        return
      }
      let ack_func: () => void = channel.ack.bind(channel, amqp_message)
      await this.callback.processSendMessageEvent(i, ack_func)
      // channel.ack(amqp_message) // Moved ACK to send when message is sucessful
      // Note: this can be after 60 seconds if we hit the telegram rate limit (we will)
    } catch (err: any) {
      this.logger.error({ err })
      Sentry.captureException(err)
    }
  }
}
