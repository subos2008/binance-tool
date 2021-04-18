#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

import { strict as assert } from 'assert';
const service_name = "binance-position-tracker";
import { fromCompletedBinanceOrderData } from '../../types/exchange_neutral/generic_order_data'


const _ = require("lodash");

require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name);
});

const send_message = require("../lib/telegram.js")(`${service_name}: `);

import { Logger } from '../../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
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
import { ExchangeEmulator } from "../../lib/exchange_emulator";
import { OrderExecutionTracker } from "../../service_lib/order_execution_tracker";
import { BinanceOrderData } from '../../interfaces/order_callbacks'
import { PositionTracker } from './position-tracker'

import { get_redis_client, set_redis_logger } from "../../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

let order_execution_tracker: OrderExecutionTracker | null = null

class MyOrderCallbacks {
  send_message: Function;
  logger: Logger;
  position_tracker: PositionTracker

  constructor({
    send_message,
    logger,
    position_tracker
  }: { send_message: (msg: string) => void, logger: Logger, position_tracker: PositionTracker }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
    assert(position_tracker);
    this.position_tracker = position_tracker;
  }

  async order_cancelled(order_id: string, data: BinanceOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} cancelled.`)
  }
  async order_filled(order_id: string, data: BinanceOrderData): Promise<void> {
    if (data.side == 'BUY') {
      this.logger.info(`BUY order on ${data.symbol} filled.`)
      this.position_tracker.buy_order_filled({ generic_order_data: fromCompletedBinanceOrderData(data) })
    }
  }
  async order_filled_or_partially_filled(order_id: string, data: BinanceOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} filled_or_partially_filled.`)
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", true);
let { live } = argv;

let ee: Object;
let position_tracker: PositionTracker;

async function main() {
  if (live) {
    logger.info("Live monitoring mode");
    assert(process.env.APIKEY)
    assert(process.env.APISECRET)
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET
    });
  } else {
    logger.info("Emulated exchange mode");
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

  position_tracker = new PositionTracker({ logger, send_message, redis })

  // await publisher.connect()

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message, position_tracker })
  order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_callbacks
  })
  order_execution_tracker.main().catch(error => {
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
  // if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
