#!./node_modules/.bin/ts-node

require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli");
  scope.setTag("cli", "positions");
});

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()


import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

const yargs = require("yargs");

import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state";
const redis_positions = new RedisPositionsState({ logger, redis })

async function open_position_ids() {
  return await redis_positions.open_position_ids()
}

async function main() {
  yargs
    .strict()
    .command(["list", "$0"], "list all positions",
      {
      }, list_positions)
    .command("delete", "delete position data from redis",
      {
        'symbol': {
          description: "symbol",
          type: "string",
          demandOption: true,
          choices: (await redis_positions.open_position_ids()).map((data: { symbol: string }) => data.symbol),
        },
        'exchange': {
          description: "exchange",
          type: "string",
          default: 'binance',
          choices: (await redis_positions.open_position_ids()).map((data: { exchange: string }) => data.exchange),
        },
        'account': {
          description: "account id",
          type: "string",
          default: 'default',
          choices: (await redis_positions.open_position_ids()).map((data: { account: string }) => data.account),
        },
      },
      delete_position
    )
    .help()
    .alias("help", "h").argv;
}
main().then(() => { });

async function list_positions(argv: any) {
  let open_positions = await redis_positions.open_position_ids()
  for (const position_tuple of open_positions) {
    console.log(position_tuple)
    console.log(await redis_positions.describe_position(position_tuple))
  }
  redis.quit();
}

async function delete_position(argv: any) {
  await redis_positions.close_position(argv)
  redis.quit();
}
