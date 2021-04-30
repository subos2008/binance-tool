#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from 'assert';
require("dotenv").config();
const connect_options = require("../../lib/amqp/connect_options").default
const service_name = "auto-position-exits";
const exchange = 'positions';
assert(exchange)
const routing_key = 'binance'

var amqp = require("amqplib/callback_api");

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

import Binance from 'binance-api-node';
import { ExchangeInfo } from 'binance-api-node';

import { connect, Connection } from "amqplib";
import { NewPositionEvent } from "../../events/position-events"
import { ExchangeEmulator } from '../../lib/exchange_emulator';

type GenericExchangeInterface = {
  exchangeInfo: () => Promise<ExchangeInfo>;
}

export class AutoPositionExits {
  ee: Object
  logger: Logger
  send_message: (msg: string) => void
  connection: Connection
  channel: any
  broker_name: string // we needed a routing key and this seems like a good one

  constructor({ ee, logger, send_message, broker_name }: { ee: Object, logger: Logger, send_message: (msg: string) => void, broker_name: string }) {
    this.ee = ee
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

  async main(queue_route = 'binance') {
    if (!this.channel) await this.connect()

    const { promisify } = require("util");


    const createChannelAsync = promisify(this.connection.createChannel).bind(this.connection);
    const channel = await createChannelAsync()

    channel.assertExchange(exchange, "topic", { durable: false });

    const assertQueueAsync = promisify(channel.assertQueue).bind(channel);
    const q = await assertQueueAsync("", { exclusive: true })

    console.log(" [*] Waiting for new messages. To exit press CTRL+C");

    channel.prefetch(1);
    channel.bindQueue(q.queue, exchange, queue_route);

    const send_message = this.send_message;
    async function message_processor(msg: any) {
      console.log(
        " [x] %s: '%s'",
        msg.fields.routingKey,
        msg.content.toString()
      );
      const message = JSON.parse(msg.content.toString());
      send_message(message)
      channel.ack(msg);
    }

    channel.consume(q.queue, message_processor, { noAck: false });
  }

  // const event: NewPositionEvent = JSON.parse(msg.content.toString());
  // this.logger.info(event)
  // if (event.event_type === 'NewPositionEvent') {
  //   this.
  // }
  async shutdown_streams() {
    throw new Error('shutdown_streams Not Implemented for AMQP listeners')
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", false);
let { live } = argv;

var auto_position_exits: AutoPositionExits;

async function main() {
  var ee: GenericExchangeInterface;
  if (live) {
    logger.info("Live monitoring mode");
    if (!process.env.APIKEY) throw new Error(`APIKEY not defined`)
    if (!process.env.APISECRET) throw new Error(`APISECRET not defined`)
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET
      // getTime: xxx // time generator function, optional, defaults to () => Date.now()
    });
  } else {
    logger.info("Emulated trading mode");
    const fs = require("fs");
    const exchange_info = JSON.parse(
      fs.readFileSync("./test/exchange_info.json", "utf8")
    );
    let ee_config = {
      starting_balances: {
        USDT: new BigNumber("50")
      },
      logger,
      exchange_info
    };
    ee = new ExchangeEmulator(ee_config);
  }

  const execSync = require("child_process").execSync;
  execSync("date -u");

  let auto_position_exits = new AutoPositionExits({
    ee,
    send_message,
    logger,
    broker_name: 'binance'
  })

  auto_position_exits.main().catch(error => {
    Sentry.captureException(error)
    if (error.name && error.name === "FetchError") {
      logger.error(
        `${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`
      );
    } else {
      logger.error(`Error in main loop: ${error}`);
      logger.error(error);
      logger.error(`Error in main loop: ${error.stack}`);
      send_message(`Error in main loop: ${error}`);
    }
    soft_exit(1);
  }).then(() => { logger.info('order_execution_tracker.main() returned.') });
}

main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
  soft_exit(1);
});

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
  if (exit_code) process.exitCode = exit_code;
  if (auto_position_exits) auto_position_exits.shutdown_streams();
  // if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
