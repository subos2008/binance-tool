#!./node_modules/.bin/ts-node

// Configuration
const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });
// End Config

const Logger = require("./lib/faux_logger");

const BigNumber = require("bignumber.js");
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
  throw Error("BigNumber .valueOf called!");
};

const Redis = require("redis");
const redis = Redis.createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const incrAsync = promisify(redis.incr).bind(redis);
const hmsetAsync = promisify(redis.hmset).bind(redis);
const setAsync = promisify(redis.set).bind(redis);

import { create_new_trade } from "./classes/persistent_state/redis_trade_state"
import { TradeDefinitionInputSpec, TradeDefinition } from "./classes/specifications/trade_definition";

const logger = new Logger({ silent: false });

const { argv } = require("yargs")
  .usage("Usage: $0")
  .example(
    "$0 -p BNBBTC  -b 0.002 -s 0.001 -t 0.003",
    "Place a buy order for BNB @ 0.002 BTC. Once filled, place a stop-limit sell @ 0.001 BTC. If a price of 0.003 BTC is reached, cancel stop-limit order and place a limit sell @ 0.003 BTC. Amount to buy will be the maximum allowed by the trading rules unless you use -q."
  )
  // '-p <tradingPair>'
  .demand("pair")
  .alias("p", "pair")
  .describe("p", "Set trading pair eg. BNBBTC")
  // '-a <base_amount>'
  .string("a")
  .alias("a", "base_amount_imported")
  .default("base_amount_imported", "0")
  .describe(
    "a",
    "Set base_amount_imported - balance imported into the trade (a pair is BASEQUOTE)"
  )
  // '-q <quote_amount>'
  .string("q")
  .alias("q", "amountquote")
  .describe("q", "Set max to buy (spend) in quote coin (a pair is BASEQUOTE)")
  // '-b <buy_price>'
  .string("b")
  .alias("b", "buy")
  .alias("b", "e")
  .alias("b", "entry")
  .describe("b", "Set buy price (omit price for market buy)")
  // '-s <stop_price>'
  .string("s")
  .alias("s", "stop")
  .describe("s", "Set stop-limit order stop price")
  // '-l <limit_price>' // needs reconnecting
  // .string("l")
  // .alias("l", "limit")
  // .describe(
  //   "l",
  //   "Set sell stop-limit order limit price (if different from stop price)"
  // )
  // '-t <target_price>'
  .string("t")
  .alias("t", "target")
  .describe("t", "Set target limit order sell price")
  // '--soft-entry'
  .boolean("soft-entry")
  .describe(
    "soft-entry",
    "Wait until the buy price is hit before creating the limit buy order"
  )
  .default("soft-entry", true)
  // '--auto-size'
  .boolean("auto-size")
  .describe(
    "auto-size",
    "Automatically size the trade based on stopLoss % and available funds"
  )
  .default("auto-size", true)
  // '--launch'
  .boolean("launch")
  .describe("launch", "Launch kubectl task to execute trade")
  .default("launch", true);
let {
  p: pair,
  a: base_amount_imported,
  q: max_quote_amount_to_buy,
  b: buy_price,
  s: stop_price,
  l: sell_stop_limit_price,
  t: target_price,
  "soft-entry": soft_entry,
  "auto-size": auto_size,
  launch
} = argv;

const trade_definition_input_spec : TradeDefinitionInputSpec = {
  pair,
  base_amount_imported,
  max_quote_amount_to_buy,
  buy_price,
  stop_price,
  target_price,
  soft_entry,
  auto_size,
  timestamp: Date.now(),
};

async function main() {
  // TODO: exceptions
  try {
    const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
    const trade_id = await create_new_trade({logger, redis, trade_definition})
    console.log(`Trade ID: ${trade_id}`);

    if (launch) {
      const launch = require("./k8/run-in-k8/launch");
      process.env.TRADE_ID = trade_id;
      launch();
    } else {
      console.log(`Trade created, note you still need to launch an executor.`);
    }
  } catch (e) {
    console.error(`Exception:`);
    console.error(e);
  }
  redis.quit();
}

main();
