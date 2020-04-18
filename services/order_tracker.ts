#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
const assert = require("assert");

require("dotenv").config();
assert(process.env.REDIS_HOST)
assert(process.env.REDIS_PASSWORD)
assert(process.env.APIKEY)
assert(process.env.APISECRET)

// redis + events + binance

// TODO: sentry
// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations (iirc lib around binance has been replaced)

const send_message = require("../lib/telegram.js")("order_tracker: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

send_message('Hello world!')

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const Binance = require("binance-api-node").default;
import { OrderExecutionTracker } from "../service_lib/order_execution_tracker";
import { OrderState } from "../classes/redis_order_state";

let live = true
let order_execution_tracker: OrderExecutionTracker | null = null

async function main() {
  var ee: Object;
  if (live) {
    logger.info("Live monitoring mode");
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
    const ExchangeEmulator = require("./lib/exchange_emulator");
    ee = new ExchangeEmulator(ee_config);
  }

  order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_state: new OrderState({ logger, redis } )
  })

  const execSync = require("child_process").execSync;
  execSync("date -u >&2");

  order_execution_tracker.main().catch(error => {
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
  }).then(() => { logger.info('main() returned.') });
}

// TODO: exceptions / sentry
main().catch(error => {
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
  soft_exit(1);
});

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  if (order_execution_tracker) order_execution_tracker.shutdown_streams();
  if (exit_code) process.exitCode = exit_code;
  if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}