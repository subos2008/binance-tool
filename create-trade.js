#!/usr/bin/env node
// Adds a trade definition to redis for the executor to execute

// Configuration
const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });
// End Config

const redis = require("redis");
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});

const { promisify } = require("util");
const incrAsync = promisify(client.incr).bind(client);
const hmsetAsync = promisify(client.hmset).bind(client);
const setAsync = promisify(client.set).bind(client);

// const logger = new Logger({ silent: false });

const { argv } = require("yargs")
  .usage("Usage: $0")
  .example(
    "$0 -p BNBBTC -a 1 -b 0.002 -s 0.001 -t 0.003",
    "Place a buy order for 1 BNB @ 0.002 BTC. Once filled, place a stop-limit sell @ 0.001 BTC. If a price of 0.003 BTC is reached, cancel stop-limit order and place a limit sell @ 0.003 BTC."
  )
  // '-p <tradingPair>'
  .demand("pair")
  .alias("p", "pair")
  .describe("p", "Set trading pair eg. BNBBTC")
  // '-a <base_amount>'
  .string("a")
  .alias("a", "base_amount")
  .describe("a", "Set base_amount to buy/sell, a pair is BASEQUOTE")
  // '-q <quote_amount>'
  .string("q")
  .alias("q", "amountquote")
  .describe(
    "q",
    "Set max to buy in quote coin (alternative to -a), a pair is BASEQUOTE"
  )
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
  // '-l <limit_price>'
  .string("l")
  .alias("l", "limit")
  .describe(
    "l",
    "Set sell stop-limit order limit price (if different from stop price)"
  )
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
  a: base_amount,
  q: max_quote_amount_to_buy,
  b: buy_price,
  s: stop_price,
  l: sell_stop_limit_price,
  t: target_price,
  "soft-entry": soft_entry,
  "auto-size": auto_size,
  launch
} = argv;

if (buy_price === "") {
  buy_price = "0";
}

const trade_definition = {
  pair,
  base_amount,
  max_quote_amount_to_buy,
  buy_price,
  stop_price,
  sell_stop_limit_price,
  target_price,
  soft_entry,
  auto_size
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
