#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require("dotenv").config();

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

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
const order_state= new OrderState({ logger, redis } )


async function main() {
  const keys = await keysAsync("orders:*:completed");
  // console.log(keys);
  for (const key of keys) {
    const completed = (await getAsync(key)) === "true";
    const order_id = key.match(/orders:(\d+):completed/)[1];
    await order_state.print(order_id)
  }
  redis.quit();
}
main();
