#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

const amqp_exchange_name = 'positions';

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
  connection: Connection | undefined
  channel: any
  amqp_routing_key: string
  callbacks: PositionsEventsCallbacks

  constructor({ logger, send_message, exchange, callbacks }: { logger: Logger, send_message: (msg: string) => void, exchange: string, callbacks: PositionsEventsCallbacks }) {
    this.logger = logger
    this.send_message = send_message
    this.amqp_routing_key = exchange
    this.callbacks = callbacks
  }

  private async message_processor(msg: any) {
    const event = JSON.parse(msg.content.toString());
    if (event.object_type === 'NewPositionEvent') {
      if (this.callbacks?.new_position_event_callback) await this.callbacks.new_position_event_callback(event as NewPositionEvent)
      await this.channel.ack(msg);
    }
  }

  async connect() {
    try {
      this.connection = await connect(connect_options)
      this.logger.info(`PositionsListener: Connection with AMQP server established.`)
      this.channel = await this.connection.createChannel() // hangs
      await this.channel.assertExchange(amqp_exchange_name, "topic", { durable: false });
      const q = await this.channel.assertQueue("", { exclusive: true })
      this.channel.bindQueue(q.queue, amqp_exchange_name, this.amqp_routing_key);
      this.channel.consume(q.queue, this.message_processor.bind(this), { noAck: false });
      this.logger.info(`PositionsListener: Waiting for new events on AMQP: exchange: ${amqp_exchange_name}, route: ${this.amqp_routing_key}.`);
    } catch (err) {
      this.logger.error(`PositionsListener:Error connecting to amqp server`);
      this.logger.error({ err });
      Sentry.captureException(err);
      throw err;
    }
  }

  async shutdown_streams() {
    if(this.connection) this.connection.close();
  }
}
