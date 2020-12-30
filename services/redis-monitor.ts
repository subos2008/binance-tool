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

require('make-promises-safe') // installs an 'unhandledRejection' handler

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

const { promisify } = require("util");
const incrAsync = promisify(redis.incr).bind(redis);

function ping() {
  incrAsync("redis-monitor:incr")
    .then((res: any) => { logger.info(`OK: ${res}`) })
    .catch((err: any) => {
      console.error(`Exception when checking redis connection with incr`)
      logger.error(err)
      Sentry.captureException(err)
    })
}

const redis_trades = new RedisTrades({ logger, redis })

function check_positions() {
  // Get all active trades
  let trade_ids = await redis_trades.get_active_trade_ids()

  // determine if we expect them to have a position or not - based on prices
  // alert if:
  // 1. no price stored
  // 2. not in position when we should be
  // 3. visa versa

  // Need: list of active trades and prices for their coins
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
