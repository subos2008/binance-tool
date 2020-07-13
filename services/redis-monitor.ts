#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';

require("dotenv").config();
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)
const connection_check_interval_seconds: number = Number(process.env.CONNECTION_TEST_INTERVAL_SECONDS) || 60

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

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

redis.on('error', function (err: any) {
  logger.warn('Redis.on errror handler called');
  console.error(err.stack);
  console.error(err);
  Sentry.withScope(function (scope: any) {
    scope.setTag("location", "redis-global-error-handler");
    Sentry.captureException(err);
  });
});

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

async function main() {
  const execSync = require("child_process").execSync;
  execSync("date -u");
  setInterval(ping, connection_check_interval_seconds * 1000); // note enabling this debug line will delay exit until it executes
}

// TODO: exceptions / sentry
main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
});
