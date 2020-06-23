const connect_options = require("../../lib/amqp/connect_options").default

import { strict as assert } from 'assert';
import { Logger } from "../../interfaces/logger";

import * as Sentry from '@sentry/node';

const exchange = 'prices';
assert(exchange)

const amqp = require("amqplib/callback_api");
const { promisify } = require("util");
const connect = promisify(amqp.connect).bind(amqp);

export class PricePublisher {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | null
  ee: any
  price_event_callback: (symbol: string, price: string, raw: any) => void
  connection: any
  channel: any

  constructor(logger: Logger, send_message: (msg: string) => void) {
    this.logger = logger
    this.send_message = send_message
  }

  async connect() {
    try {
      // this.logger.info(`AMQP connect options:`)
      // this.logger.info(connect_options)
      this.connection = await connect(connect_options)
      const createChannel = promisify(this.connection.createChannel).bind(this.connection);
      this.channel = await createChannel()
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

  async publish(event: any, routing_key: string) {
    event.routing_key = routing_key;
    let msg = JSON.stringify(event);
    this.channel.publish(exchange, routing_key, Buffer.from(msg));
    // this.logger.info(` [x] Sent event to ${routing_key}`);
  }

  async shutdown_streams() {
    this.connection.close();
  }
}
