#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';
const service_name = "price-monitor";
const timeout_seconds = Number(process.env.WATCHDOG_TIMEOUT_SECONDS || "3600")

const _ = require("lodash");

require("dotenv").config();
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)
// assert(process.env.APIKEY)
// assert(process.env.APISECRET)

import * as Sentry from '@sentry/node';
Sentry.init({});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name);
});

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

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

const Binance = require("binance-api-node").default;
import { BinancePriceMonitor } from "../classes/binance_price_monitor";
import { PricePublisher } from "../classes/amqp/price-publisher";
import { RedisTrades } from "../classes/persistent_state/redis_trades";
import { TradeState } from "../classes/persistent_state/redis_trade_state";
import { RedisWatchdog } from "../classes/persistent_state/redis_watchdog";
import { ExchangeEmulator } from "../lib/exchange_emulator";

const publisher = new PricePublisher(logger, send_message)
const redis_trades = new RedisTrades({ logger, redis })

const watchdog = new RedisWatchdog({ logger, redis, watchdog_name: service_name, timeout_seconds })

var first_price_event_recieved = false
const price_event_callback = (symbol: string, price: string, raw: any) => {
  if(!first_price_event_recieved) {
    console.log(`Received first price event ${symbol} ${price}.`)
    first_price_event_recieved = true
  }
  let event = { symbol, price, raw }
  publisher.publish(event, symbol)
}

var monitor = null;

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", true);
let { live } = argv;

var ee: Object;

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

  await publisher.connect()
  update_monitors_if_active_pairs_have_changed()
  setInterval(update_monitors_if_active_pairs_have_changed, 1000 * 30)
}


async function get_active_pairs() {
  let trade_ids = await redis_trades.get_active_order_ids()
  let pairs: string[] = []
  for (const trade_id of trade_ids) {
    try {
      let trade_state = new TradeState({ logger, redis, trade_id })
      let trade_definition = await trade_state.get_trade_definition()
      pairs.push(trade_definition.pair)
      // logger.info(`Trade ${trade_id}: ${trade_definition.pair}`)
    } catch (err) {
      Sentry.captureException(err)
      logger.error(`Failed to create TradeDefinition for trade ${trade_id}`)
      logger.error(err)
    }
  }
  return new Set(pairs.sort())
}

let currently_monitored_pairs: Set<string> = new Set([])

async function update_monitors_if_active_pairs_have_changed() {
  let active_pairs = await get_active_pairs()
  active_pairs.add("BTCUSDT") // We want the system under some stress so always add this
  if (!_.isEqual(currently_monitored_pairs, active_pairs)) {
    logger.info(`Active Pairs: ${Array.from(active_pairs)}`)
    logger.info(`currently_monitored_pairs: ${Array.from(currently_monitored_pairs)}`)
    if (Array.from(currently_monitored_pairs).length != 0) {
      // let's die to change the monitored pairs, we will be restarted and can cleanly monitor the new 
      // set from a fresh process. We can investigate cleanly replacing monitors later at our
      // leasure
      try {
        const message = `Changing to monitor: ${Array.from(active_pairs).join(', ')}`
        logger.info(message)
        send_message(message)
        logger.warn('Exiting to replace monitors')
      } finally {
        process.exit(0)
      }
    }
    currently_monitored_pairs = active_pairs
    monitor = new BinancePriceMonitor(logger, watchdog, send_message, ee, price_event_callback)
    monitor.monitor_pairs(Array.from(active_pairs))
  }
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
