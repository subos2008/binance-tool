"use strict"

import Sentry from "../../lib/sentry"

import { Logger } from "../../interfaces/logger"
import { GenericTopicPublisher } from "../amqp/generic-publishers"
import { MyEventNameType } from "../amqp/message-routing"
import { HealthAndReadinessSubsystem } from "../health_and_readiness"

export type SendMessageFunc = (msg: string, tags?: ContextTags) => Promise<void>

export interface ContextTags {
  edge?: string
  base_asset?: string
  class?: string // name of the class calling send_message
  exchange_type?: "spot" | "futures"
}

export interface SendMessageEvent {
  object_type: "SendMessage"
  service_name: string
  msg: string
  tags: ContextTags
}

export class SendMessage {
  service_name: string
  logger: Logger
  publisher: SendMessagePublisher
  health_and_readiness: HealthAndReadinessSubsystem | undefined

  constructor({
    service_name,
    logger,
    health_and_readiness,
  }: {
    service_name: string
    logger: Logger
    health_and_readiness?: HealthAndReadinessSubsystem
  }) {
    this.service_name = service_name
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.publisher = new SendMessagePublisher({ logger, health_and_readiness })
  }

  build(): SendMessageFunc {
    return this.send_message.bind(this)
  }

  async send_message(message: string, _tags?: ContextTags) {
    try {
      this.publisher.publish
    } catch (err) {
      this.logger.error({ err, msg: `Failed to send message: ${message}` })
      Sentry.captureException(err)
      if (this.health_and_readiness) this.health_and_readiness.healthy(true)
    }
  }
}

class SendMessagePublisher {
  logger: Logger
  closeTradesWebSocket: (() => void) | undefined
  pub: GenericTopicPublisher | undefined
  event_name: MyEventNameType
  health_and_readiness: HealthAndReadinessSubsystem | undefined

  constructor({
    logger,
    health_and_readiness,
  }: {
    logger: Logger
    health_and_readiness?: HealthAndReadinessSubsystem
  }) {
    this.logger = logger
    this.health_and_readiness = health_and_readiness
    this.event_name = "SendMessage"
  }

  async connect(): Promise<void> {
    try {
      if (!this.pub) throw new Error(`this.pub not defined in connect()`)
      await this.pub.connect()
    } catch (err) {
      this.logger.error({ err, msg: `Failed to connect to AMQP in SendMessagePublisher` })
      Sentry.captureException(err)
      if (this.health_and_readiness) this.health_and_readiness.ready(false)
      throw err
    }
    if (this.health_and_readiness) {
      this.health_and_readiness.ready(true)
      this.health_and_readiness.healthy(true)
    }
  }

  async publish(event: SendMessageEvent): Promise<void> {
    if (!this.pub) {
      this.pub = new GenericTopicPublisher({ logger: this.logger, event_name: this.event_name })
      this.connect()
    }
    const options = {
      // expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    try {
      await this.pub.publish(event, options)
    } catch (e) {
      if (this.health_and_readiness) this.health_and_readiness.healthy(false)
    }
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
    if (this.health_and_readiness) this.health_and_readiness.healthy(false)
  }
}
