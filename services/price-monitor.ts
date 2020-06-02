#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';


require("dotenv").config();
assert(process.env.REDIS_HOST)
assert(process.env.REDIS_PASSWORD)
assert(process.env.APIKEY)
assert(process.env.APISECRET)

const Sentry = require("@sentry/node");

// redis + events + binance

// TODO: sentry
// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations (iirc lib around binance has been replaced)

const send_message = require("../lib/telegram.js")("price-monitor: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

logger.warn(`TODO: don't die if redis isn't accessible`)
send_message('starting')

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const Binance = require("binance-api-node").default;
import { BinancePriceMonitor } from "../classes/binance_price_monitor";
import { PricePublisher } from "../classes/amqp/price-publisher";

let live = true

async function main() {
  var ee: Object;
  if (live) {
    logger.info("Live monitoring mode");
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
    const ExchangeEmulator = require("./lib/exchange_emulator");
    ee = new ExchangeEmulator(ee_config);
  }

  const execSync = require("child_process").execSync;
  execSync("date -u");

  const publisher = new PricePublisher(logger, send_message)
  await publisher.connect()

  const price_event_callback = (symbol: string, price: string, raw: any) => {
    logger.info(`Callback: ${symbol}: ${price}`)
    let event = { symbol, price, raw }
    publisher.publish(event, symbol)
  }

  const monitor = new BinancePriceMonitor(logger, send_message, ee, price_event_callback)
  monitor.monitor_pairs(["FUELBTC", "GVTBTC", "LINKBTC", "MATICBTC", "QKCBTC", "STEEMBTC", "TNTBTC", "ZILBTC", "BTCUSDT"])
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
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
  if (exit_code) process.exitCode = exit_code;
  if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
