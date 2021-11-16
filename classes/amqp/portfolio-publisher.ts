const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from "assert"
import { Logger } from "../../interfaces/logger"

import * as Sentry from "@sentry/node"

import { connect, Connection } from "amqplib"
import { Portfolio } from "../../interfaces/portfolio"
import { ExchangeIdentifier } from "../../events/shared/exchange-identifier"
import { GenericTopicPublisher } from "./generic-publishers"
import { MyEventNameType } from "./message-routing"

export class PortfolioPublisher {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | null
  connection: Connection
  channel: any
  exchange_identifier: ExchangeIdentifier
  routing_key: string
  pub: GenericTopicPublisher
  event_name: MyEventNameType

  constructor({
    logger,
    send_message,
    exchange_identifier,
    event_name,
  }: {
    logger: Logger
    send_message: (msg: string) => void
    exchange_identifier: ExchangeIdentifier
    event_name: MyEventNameType
  }) {
    this.logger = logger
    this.send_message = send_message
    this.exchange_identifier = exchange_identifier
    // we needed a routing key and this seems like a good one
    this.routing_key = `${exchange_identifier.exchange}:${exchange_identifier.account}`
    this.event_name = event_name

    assert.strictEqual(exchange_identifier.exchange, "binance")
    assert.strictEqual(exchange_identifier.account, "default")
    this.pub = new GenericTopicPublisher({ logger, event_name })
  }

  async connect() {
    return this.pub.connect()
  }

  async publish(event: Portfolio): Promise<void> {
    // Extract only those fields we want to publish
    let trimmed_event: Portfolio = {
      usd_value: event.usd_value,
      btc_value: event.btc_value,
      balances: event.balances,
      prices: event.prices,
    }
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now(),
    }
    await this.pub.publish(JSON.stringify(trimmed_event), options)
  }

  async shutdown_streams() {
    if (this.pub) this.pub.shutdown_streams()
  }
}
