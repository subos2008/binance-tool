const connect_options = require("../../lib/amqp/connect_options")

import { strict as assert } from 'assert';
import { Logger } from "../../interfaces/logger";

const Sentry = require("@sentry/node");

console.warn(`WARNING: amqp publish implementation creates channel on every message`)

// topic exchange: ...
// topic/routing key: something.something_else -> queue post-created-queue
// consumer creates it's own queue and binding
// "Trying to filter once the message is in the queue, is an anti-pattern in RabbitMQ."
//     - https://derickbailey.com/2015/09/02/rabbitmq-best-practices-for-designing-exchanges-queues-and-bindings/

// Create topic exchange, but not actually any routing, the consumer can create the
// routing and queues it needs.

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
      this.connection = await connect(connect_options)
      const createChannel = promisify(this.connection.createChannel).bind(this.connection);
      this.channel = await createChannel()
      this.channel.assertExchange(exchange, "topic", {
        durable: false
      });
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
    this.logger.info(` [x] Sent event to ${routing_key}`);
  }

  async shutdown_streams() {
    this.connection.close();
  }
}
