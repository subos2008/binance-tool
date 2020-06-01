#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
import { strict as assert } from 'assert';

require("dotenv").config();
assert(process.env.REDIS_HOST)
assert(process.env.REDIS_PASSWORD)

const Sentry = require("@sentry/node");

const send_message = require("../lib/telegram.js")("redis-monitor: ");

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

send_message('starting')

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const incrAsync = promisify(redis.incr).bind(redis);

function ping() {
  redis.incrAsync("redis-monitor:incr")
    .then((res : any) => { logger.info(`OK: ${res}`) })
    .catch((err:any) => {
      logger.error(err)
      Sentry.captureException(err)
    })
}

async function main() {
  const execSync = require("child_process").execSync;
  execSync("date -u");
  setInterval(ping, 1000*60); // note enabling this debug line will delay exit until it executes
}

// TODO: exceptions / sentry
main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
});
