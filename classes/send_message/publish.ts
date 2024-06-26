"use strict"

import Sentry from "../../lib/sentry"

import { Logger } from "../../interfaces/logger"
import { MyEventNameType } from "../amqp/message-routing"
import { HealthAndReadiness } from "../health_and_readiness"
import { ContextTags, SendMessageFunc } from "../../interfaces/send-message"
import { TypedGenericTopicPublisher } from "../amqp/typed-generic-publisher"

export interface SendMessageEvent {
  object_type: "SendMessageEvent"
  service_name: string
  msg: string
  tags: ContextTags
}

export class SendMessage {
  service_name: string
  logger: Logger
  publisher: SendMessagePublisher

  constructor({
    service_name,
    logger,
    health_and_readiness,
  }: {
    service_name: string
    logger: Logger
    health_and_readiness: HealthAndReadiness
  }) {
    this.service_name = service_name
    this.logger = logger
    this.publisher = new SendMessagePublisher({ logger, health_and_readiness })
  }

  build(): SendMessageFunc {
    return this.send_message.bind(this)
  }

  send_message(message: string, _tags?: ContextTags) {
    let tags = _tags || {}
    try {
      if (!message) {
        this.logger.error(`Empty message in send_message!`)
        console.trace(`Empty message in send_message!`)
      }
      let event: SendMessageEvent = {
        object_type: "SendMessageEvent",
        msg: message,
        service_name: this.service_name,
        tags,
      }
      this.logger.event(tags, event)
      this.publisher.publish(event).catch((err) => {
        this.logger.error({ ...tags, err }, `Failed to send message: ${message}`)
        Sentry.captureException(err)
      })
    } catch (err) {
      this.logger.error({ ...tags, err }, `Failed to send message: ${message}`)
      Sentry.captureException(err)
    }
  }
}

class SendMessagePublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  pub: TypedGenericTopicPublisher<SendMessageEvent>
  event_name: MyEventNameType
  health_and_readiness: HealthAndReadiness

  constructor({ logger, health_and_readiness }: { logger: Logger; health_and_readiness: HealthAndReadiness }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.event_name = "SendMessageEvent"
    this.pub = new TypedGenericTopicPublisher<SendMessageEvent>({
      logger: this.logger,
      event_name: this.event_name,
      health_and_readiness: this.health_and_readiness,
    })
    this.pub.connect().catch((err) => {
      console.error(`SendMessagePublisher failed to connect: ${err}`)
      console.error(err)
    })
  }

  async connect(): Promise<void> {
    try {
      await this.pub.connect()
    } catch (err) {
      this.logger.error({}, err)
      this.logger.error(`Failed to connect SendMessagePublisher in SendMessage`)
      throw err
    }
  }

  async publish(event: SendMessageEvent): Promise<void> {
    const options = {
      // expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    await this.pub.publish(event, options)
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}
