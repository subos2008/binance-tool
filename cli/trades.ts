#!./node_modules/.bin/ts-node

require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli");
  scope.setTag("cli", "trades");
});

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const keysAsync = promisify(redis.keys).bind(redis);
const getAsync = promisify(redis.get).bind(redis);
const hgetallAsync = promisify(redis.hgetall).bind(redis);
const setAsync = promisify(redis.set).bind(redis);

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

const yargs = require("yargs");

async function sorted_trade_ids() {
  const keys = await keysAsync("trades:*:completed");
  return keys.map((key: any) => parseInt(key.match(/:(\d+):/)[1])).sort((a: any, b: any) => a - b)
}

async function main() {
  yargs
    .strict()
    .command(
      "describe",
      "details of trade",
      {
        'trade-id': {
          description: "trade id",
          type: "string",
          demandOption: true,
          choices: (await sorted_trade_ids()).map((n: number) => n.toString()),
        },
      },
      describe_trade
    )
    .command("complete", "mark trade as complete",
      {
        'trade-id': {
          description: "trade id",
          type: "string",
          demandOption: true,
          choices: (await sorted_trade_ids()).map((n: number) => n.toString()),
        },
      },
      mark_trade_complete
    )
    .command("incomplete", "mark trade as NOT complete",
      {
        'trade-id': {
          description: "trade id",
          type: "string",
          demandOption: true,
          choices: (await sorted_trade_ids()).map((n: number) => n.toString()),
        },
      },
      mark_trade_incomplete
    )
    .command(["list", "$0"], "list all trades",
      {
        'active': { description: "only list active trades", type: "boolean", },
        'position': { description: "only list trade in positions", type: "boolean", },
      }, list_trades)
    .help()
    .alias("help", "h").argv;
}
main().then(() => { });

async function describe_trade(argv: any) {
  let trade_id = argv['trade-id']
  // console.log(`Trade ID: ${trade_id}`)
  let keys = await keysAsync(`trades:${trade_id}:*`);
  const output_obj: any = {}
  keys = keys.map((key: string) => key.match(/trades:[^:]+:(.*)$/)?.[1] ?? null)
  for (const key of keys) {
    switch (key) {
      case "trade_definition":
        const trade_definition = await hgetallAsync(`trades:${trade_id}:trade_definition`);
        output_obj[key] = trade_definition
        break;
      default:
        const value = await getAsync(`trades:${trade_id}:${key}`);
        output_obj[key] = value
    }
  }
  console.log(output_obj)
  redis.quit();
}

async function mark_trade_complete(argv: any) {
  let trade_id = argv['trade-id']
  let key = `trades:${trade_id}:completed`
  let keys: string[] = await keysAsync(key);
  if (keys.length !== 1) {
    throw new Error(`Trade ${trade_id} doesn't appear to exist.`)
  }
  const ret = await setAsync(key, true)
  if (ret !== 'OK') {
    throw new Error(`Redis error: failed to set key ${key}: ${ret}`)
  }
  console.log(`Done.`)
  redis.quit();
}

async function mark_trade_incomplete(argv: any) {
  let trade_id = argv['trade-id']
  let key = `trades:${trade_id}:completed`
  let keys: string[] = await keysAsync(key);
  if (keys.length !== 1) {
    throw new Error(`Trade ${trade_id} doesn't appear to exist.`)
  }
  const ret = await setAsync(key, false)
  if (ret !== 'OK') {
    throw new Error(`Redis error: failed to set key ${key}: ${ret}`)
  }
  console.log(`Done.`)
  redis.quit();
}

async function list_trades(argv: any) {
  if (argv['position']) { console.log(`Warning position determination is inaccurate.`) };

  let trade_ids = await sorted_trade_ids()
  for (const trade_id of trade_ids) {
    // needs to include imported too = port this util to use trade_state
    const position = await getAsync(`trades:${trade_id}:position:base_amount_bought`);
    const completed = (await getAsync(`trades:${trade_id}:completed`)) === "true";
    if (argv['active'] && completed) { continue };
    if (argv['position'] && !position) { continue };
    const foo = await hgetallAsync(`trades:${trade_id}:trade_definition`);
    const flags = [];
    if (foo["soft_entry"]) flags.push("soft_entry");
    if (foo["auto_size"]) flags.push("auto_size");
    console.log(
      `${completed ? " " : "A"} Trade ${trade_id}: ${foo.pair}: ${
      (new BigNumber(foo.stop_price)).toFixed(8)
      } ${(new BigNumber(foo.buy_price)).toFixed(8)} ${(new BigNumber(foo.target_price)).toFixed(8)} ${flags.join(" ")} ${position || ""}`
    );
  }
  redis.quit();
}
