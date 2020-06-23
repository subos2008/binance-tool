#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';

require("dotenv").config();
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)
// assert(process.env.APIKEY)
// assert(process.env.APISECRET)

const Sentry = require("@sentry/node");
Sentry.init({
  dsn: "https://fdceaf9d5e984c6aad15f6ec0301f1f5@o369902.ingest.sentry.io/5286784"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "order-tracker");
});

// redis + events + binance

// TODO: sentry
// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations (iirc lib around binance has been replaced)

const send_message = require("../lib/telegram.js")("order-tracker: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

send_message('restarted.')

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()


const Binance = require("binance-api-node").default;
import { OrderExecutionTracker } from "../service_lib/order_execution_tracker";
import { OrderState } from "../classes/persistent_state/redis_order_state";
import { ExchangeEmulator } from "../lib/exchange_emulator";

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", false);
let { live } = argv;

let order_execution_tracker: OrderExecutionTracker | null = null

async function main() {
  var ee: Object;
  if (live) {
    logger.info("Live monitoring mode");
    assert(process.env.APIKEY)
    assert(process.env.APISECRET)
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

  order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_state: new OrderState({ logger, redis })
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

// TODO: exceptions / sentry
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
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
  if (order_execution_tracker) order_execution_tracker.shutdown_streams();
  if (exit_code) process.exitCode = exit_code;
  if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
