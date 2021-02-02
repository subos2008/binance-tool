#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';

require("dotenv").config();
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)
const connection_check_interval_seconds: number = Number(process.env.CONNECTION_TEST_INTERVAL_SECONDS) || 60
const check_positions_interval_seconds: number = Number(process.env.CHECK_POSITIONS_INTERVAL_SECONDS) || 300

import * as Sentry from '@sentry/node';
Sentry.init({});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "redis-monitor");
});

const send_message = require("../lib/telegram.js")("redis-monitor: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

send_message('starting')

process.on("unhandledRejection", error => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`);
});

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()
import { TradeState } from '../classes/persistent_state/redis_trade_state'
import { SymbolPrices } from "../classes/persistent_state/redis_symbol_prices";
const symbol_prices = new SymbolPrices({ logger, redis, exchange_name: 'binance', seconds: 5 * 60 })

const { promisify } = require("util");
const incrAsync = promisify(redis.incr).bind(redis);

function ping() {
  incrAsync("redis-monitor:incr")
    .then((res: any) => { logger.info(`Connection Check: OK (${res})`) })
    .catch((err: any) => {
      logger.error(`Exception when checking redis connection with incr`)
      logger.error(err)
      Sentry.captureException(err)
    })
}

import { RedisTrades } from "../classes/persistent_state/redis_trades";
const redis_trades = new RedisTrades({ logger, redis })

async function check_positions() : Promise<void> {
  // Get all active trades
  let trade_ids = await redis_trades.get_active_trade_ids()

  let prices_available_check_ok = true
  for (const trade_id of trade_ids) {
    try {
      let trade_state = new TradeState({ logger, redis, trade_id })
      let trade_definition = await trade_state.get_trade_definition()
      // determine if we expect them to have a position or not - based on prices
      // alert if:
      // 1. no price stored
      // 2. not in position when we should be
      // 3. visa versa
      let symbol = trade_definition.pair
      let current_price = await symbol_prices.get_price(symbol)
      if ( typeof current_price == 'undefined' ){
        prices_available_check_ok = false
        throw new Error(`Symbol ${symbol} has no price in redis but has active trade_id ${trade_id}`)
      }

    } catch (err) {
      Sentry.captureException(err)
      logger.error(`Exception in check_poitions for trade ${trade_id}`)
      logger.error(err)
    }
  }

  if(prices_available_check_ok) {
    logger.info(`Prices in Redis Check: OK`)
  } else {
    logger.error(`Prices in Redis Check: FAILED`)
  }
}

async function main() {
  const execSync = require("child_process").execSync;
  execSync("date -u");
  setInterval(ping, connection_check_interval_seconds * 1000);
  setInterval(check_positions, check_positions_interval_seconds * 1000);
}

// TODO: exceptions / sentry
main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
});
