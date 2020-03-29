#!/usr/bin/env node
// Adds a trade definition to redis for the executor to execute

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

const redis = require("redis");
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const incrAsync = promisify(client.incr).bind(client);
const hmsetAsync = promisify(client.hmset).bind(client);
const setAsync = promisify(client.set).bind(client);

const {
  initialiser: trade_state_initialiser
} = require("./classes/redis_trade_state");

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
  .alias("a", "base_amount_held")
  .default("base_amount_held", "0")
  .describe(
    "a",
    "Set base_amount_held - balance imported into the trade (a pair is BASEQUOTE)"
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
  a: base_amount_held,
  q: max_quote_amount_to_buy,
  b: buy_price,
  s: stop_price,
  l: sell_stop_limit_price,
  t: target_price,
  "soft-entry": soft_entry,
  "auto-size": auto_size,
  launch
} = argv;

const trade_definition = {
  pair,
  base_amount_held, // not used in the trade defn but stored there
  max_quote_amount_to_buy,
  buy_price,
  stop_price,
  sell_stop_limit_price,
  target_price,
  soft_entry,
  auto_size,
  timestamp: Date.now()
};

async function main() {
  var trade_definition_as_list = [];
  for (var key in trade_definition) {
    if (trade_definition[key] != undefined) {
      trade_definition_as_list.push(key);
      trade_definition_as_list.push(trade_definition[key]);
    }
  }

  // TODO: exceptions
  try {
    const trade_id = await incrAsync("trades:next:trade_id");
    console.log(`Trade ID: ${trade_id}`);

    const prefix = `trades:${trade_id}`;

    await setAsync(`${prefix}:completed`, false);

    const redis_key = `${prefix}:trade_definition`;
    console.log(trade_definition);
    await hmsetAsync(redis_key, trade_definition_as_list);

    base_amount_held = BigNumber(base_amount_held);
    await trade_state_initialiser({
      redis: client,
      logger,
      trade_id,
      base_amount_held
    });

    if (launch) {
      const launch = require("./k8/run-in-k8/launch");
      process.env.TRADE_ID = trade_id;
      launch();
    } else {
      console.log(`Trade created, note you still need to launch an executor.`);
    }

    console.log(`Redis key: ${redis_key}`);
  } catch (e) {
    console.error(`Exception:`);
    console.error(e);
  }
  client.quit();
}

main();
