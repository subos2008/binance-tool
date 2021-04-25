import { strict as assert } from 'assert';

const connect_options = require("../../lib/amqp/connect_options").default
const service_name = "auto-position-exits";
const exchange = 'positions';

var amqp = require("amqplib/callback_api");
require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name);
});

const send_message = require("../../lib/telegram.js")(`${service_name}: `);

import { Logger } from '../../interfaces/logger'
const LoggerClass = require("../../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

send_message('starting')

process.on("unhandledRejection", error => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`);
});

const Binance = require("binance-api-node").default;

import { connect, Connection } from "amqplib";
import { NewPositionEvent } from "../../events/position-events"

export class PositionPublisher {
  logger: Logger
  send_message: (msg: string) => void
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
  async run() {
    this.channel.assertQueue(
      "",
      {
        exclusive: true
      },
      function (error2: any, q: any) {
        if (error2) {
          throw error2;
        }
        console.log(" [*] Waiting for events");

        this.channel.bindQueue(q.queue, exchange, "homepage.new_post");

        this.channel.prefetch(1);

        this.channel.consume(
          q.queue,
          function (msg: any) {
            function ack() {
              this.channel.ack(msg);
            }

            console.log(
              " [x] %s: '%s'",
              msg.fields.routingKey,
              msg.content.toString()
            );
            const event: NewPositionEvent = JSON.parse(msg.content.toString());
            this.logger.info(event)
            if(event.event_type === 'NewPositionEvent') {
              // TODO: be badass
            }
          },
          {
            noAck: false
          }
        );
      }
    );
  }
}


