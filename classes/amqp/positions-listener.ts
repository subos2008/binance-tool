#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from 'assert';

const amqp_exchange_name = 'positions';
const routing_key = 'binance'

const connect_options = require("../../lib/amqp/connect_options").default

import * as Sentry from '@sentry/node';

import { connect, Connection } from "amqplib";
import { Logger } from '../../interfaces/logger'

import { NewPositionEvent } from "../../events/position-events"

export interface PositionsEventsCallbacks {
  new_position_event_callback?: (event: NewPositionEvent) => Promise<void>
}
export class PositionsListener {
  logger: Logger
  send_message: (msg: string) => void
  connection: Connection
  channel: any
  amqp_routing_key: string
  callbacks: PositionsEventsCallbacks

  constructor({ logger, send_message, exchange, callbacks }: { logger: Logger, send_message: (msg: string) => void, exchange: string, callbacks: PositionsEventsCallbacks }) {
    this.logger = logger
    this.send_message = send_message
    this.amqp_routing_key = exchange
    this.callbacks = callbacks
  }

  async connect() {
    try {
      this.connection = await connect(connect_options)
      this.channel = await this.connection.createChannel()
      this.channel.assertExchange(amqp_exchange_name, "topic", {
        durable: false
      });
      this.logger.info(`Connection with AMQP server established.`)
    } catch (err) {
      this.logger.error(`Error connecting to amqp server`);
      this.logger.error(err);
      Sentry.captureException(err);
      throw err;
    }

    this.run(this.amqp_routing_key)
  }

  private async message_processor(msg: any) {
    console.log(
      " [x] %s: '%s'",
      msg.fields.routingKey,
      msg.content.toString()
    );
    this.send_message(msg.content.toString())

    const event = JSON.parse(msg.content.toString());
    if (event.event_type === 'NewPositionEvent') {
      if (this.callbacks?.new_position_event_callback) await this.callbacks.new_position_event_callback(event as NewPositionEvent)
      await this.channel.ack(msg);
    }
  }

  private async run(queue_route: string) {
    const { promisify } = require("util");
    const createChannelAsync = promisify(this.connection.createChannel).bind(this.connection);

    const channel = await createChannelAsync()
    channel.assertExchange(amqp_exchange_name, "topic", { durable: false });

    const assertQueueAsync = promisify(channel.assertQueue).bind(channel);
    const q = await assertQueueAsync("", { exclusive: true })

    this.send_message(`Waiting for new events on AMQP: exchange: ${amqp_exchange_name}, route: ${queue_route}.`);

    channel.prefetch(1);
    channel.bindQueue(q.queue, amqp_exchange_name, queue_route);

    const send_message = this.send_message;
    // TODO: pass ack to callback?


    channel.consume(q.queue, this.message_processor.bind(this), { noAck: false });
  }


  async shutdown_streams() {
    this.connection.close();
  }
}
