const connect_options = require("../../lib/amqp/connect_options").default

const event_expiration_seconds = "60"

import { strict as assert } from 'assert';
import { Logger } from "../../interfaces/logger";

import * as Sentry from '@sentry/node';

const exchange = 'portfolio';
assert(exchange)

import { connect, Connection } from "amqplib";
import { Portfolio } from "../../interfaces/portfolio"

export class PortfolioPublisher {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | null
  connection: Connection
  channel: any
  broker_name: string // we needed a routing key and this seems like a good one

  constructor({ logger, send_message, broker_name }: { logger: Logger, send_message: (msg: string) => void, broker_name: string }) {
    this.logger = logger
    this.send_message = send_message
    this.broker_name = broker_name
  }

  async connect() {
    try {
      this.connection = await connect(connect_options)
      this.channel = await this.connection.createChannel()
      this.channel.assertExchange(exchange, "topic", {
        durable: false
      });
      this.logger.info(`Connection with AMQP server established.`)
    } catch (err) {
      this.logger.error(`Error connecting to amqp server`);
      this.logger.error(err);
      Sentry.captureException(err);
      throw err;
    }
  }

  async publish(event: Portfolio): Promise<boolean> {
    // Extract only those fields we want to publish
    let trimmed_event: Portfolio = {
      usd_value: event.usd_value,
      btc_value: event.btc_value,
      balances: event.balances,
      prices: event.prices
    }
    let msg = JSON.stringify(trimmed_event);
    const options = {
      expiration: event_expiration_seconds,
      persistent: false,
      timestamp: Date.now()
    }
    const routing_key = this.broker_name
    const server_full = await this.channel.publish(exchange, routing_key, Buffer.from(msg), options);
    return server_full
  }

  async shutdown_streams() {
    this.connection.close();
  }
}
