#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require("dotenv").config();

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli");
  scope.setTag("cli", "list-orders");
});

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const keysAsync = promisify(redis.keys).bind(redis);
const getAsync = promisify(redis.get).bind(redis);
const hgetallAsync = promisify(redis.hgetall).bind(redis);
const mgetAsync = promisify(redis.mget).bind(redis);

import { OrderState } from "../classes/persistent_state/redis_order_state";
const order_state = new OrderState({ logger, redis })


async function main() {
  const keys = await keysAsync("orders:*:completed");
  // console.log(keys);
  for (const key of keys) {
    const completed = (await getAsync(key)) === "true";
    let regex_result = key.match(/orders:([^:]+):completed/)
    try {
      const order_id = regex_result[1];
      await order_state.print(order_id)
    } catch (e) {
      logger.error(e)
      logger.error(`Error decompising order id from redis key: ${key}`)
    }
  }
  redis.quit();
}
main();
