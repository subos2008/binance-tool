#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';

require("dotenv").config();
assert(process.env.REDIS_HOST)
// assert(process.env.REDIS_PASSWORD)

const Sentry = require("@sentry/node");
Sentry.init({
  dsn: "https://673cf6fd7c5e49339128d0f4bb3f37c7@o369902.ingest.sentry.io/5286786"
});
Sentry.configureScope(function(scope:any) {
  scope.setTag("service", "redis-monitor");
});

const send_message = require("../lib/telegram.js")("redis-monitor: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

send_message('starting')

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const incrAsync = promisify(redis.incr).bind(redis);

function ping() {
  incrAsync("redis-monitor:incr")
    .then((res : any) => { logger.info(`OK: ${res}`) })
    .catch((err:any) => {
      logger.error(err)
      Sentry.captureException(err)
    })
}

function inspect_price_monitor() {

}

async function main() {
  const execSync = require("child_process").execSync;
  execSync("date -u");
  setInterval(ping, 1000*60); // note enabling this debug line will delay exit until it executes
  setInterval(inspect_price_monitor, 1000*60); // note enabling this debug line will delay exit until it executes
}

// TODO: exceptions / sentry
main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
});
