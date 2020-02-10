#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require("dotenv").config();

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

const redis = require("redis");
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});
const { promisify } = require("util");
const hgetallAsync = promisify(client.hgetall).bind(client);
const Binance = require("binance-api-node").default;
const send_message = require("./lib/telegram.js");
const Algo = require("./service_lib/algo");
const Logger = require("./lib/faux_logger");
const BigNumber = require("bignumber.js");
const TradingRules = require("./lib/trading_rules");

const logger = new Logger({ silent: false });

// TODO: load from shared yaml file with binance.js
// eg: const vars = YAML.parse(fs.readFileSync(process.env.VARS_INPUT_FILENAME, 'utf8'));
// with: const YAML = require('yaml');
console.log("Warning trading rules hardcoded twice");
const trading_rules = new TradingRules({
  max_allowed_portfolio_loss_percentage_per_trade: BigNumber("1"),
  allowed_to_trade_without_stop: true
});

var { argv } = require("yargs")
  .usage("Usage: $0 --trade-id <trade-id>")
  .example("$0 --trade-id 1")
  // '-T <trade_id>'
  .string("trade-id")
  .demand("trade-id")
  .describe("trade-id", "ID of trade_definition to load from redis")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", false);
let { "trade-id": trade_id, live } = argv;
var algo;

async function main() {
  var stringToBool = myValue => myValue === 'true';
  const redis_key = `trades:${trade_id}:trade_definition`;
  const trade_definition = await hgetallAsync(redis_key);
  trade_definition.auto_size = stringToBool(trade_definition.auto_size)
  trade_definition.soft_entry = stringToBool(trade_definition.soft_entry)
  client.quit();
  console.log(`From redis:`);
  console.log(trade_definition);
  if (trade_definition === null) {
    logger.error(`Got null from Redis. Trade ${trade_id} likely doesn't exist`);
    soft_exit(1);
    return; // exit
  }

  let {
    pair,
    base_amount,
    max_quote_amount_to_buy,
    buy_price,
    stop_price,
    sell_stop_limit_price: limit_price,
    target_price,
    nonBnbFees,
    soft_entry,
    auto_size
  } = trade_definition;

  if (buy_price === "") {
    buy_price = "0";
  }

  var ee;
  if (live) {
    logger.info("Live trading mode");
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET
      // getTime: xxx // time generator function, optional, defaults to () => Date.now()
    });
  } else {
    logger.info("Emulated trading mode");
    const fs = require("fs");
    const exchange_info = JSON.parse(
      fs.readFileSync("./test/exchange_info.json", "utf8")
    );
    let ee_config = {
      starting_balances: {
        USDT: BigNumber("50")
      },
      logger,
      exchange_info
    };
    const ExchangeEmulator = require("./lib/exchange_emulator");
    ee = new ExchangeEmulator(ee_config);
  }

  algo = new Algo({
    ee,
    send_message,
    logger,
    pair,
    base_amount,
    max_quote_amount_to_buy,
    buy_price,
    stop_price,
    limit_price,
    target_price,
    nonBnbFees,
    soft_entry,
    trading_rules,
    auto_size
  });

  const execSync = require("child_process").execSync;
  code = execSync("date -u >&2");

  algo.main().catch(error => {
    if (error.name && error.name === "FetchError") {
      logger.error(
        `${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`
      );
    } else if (
      error.message &&
      error.message.includes("exception in setup code")
    ) {
      logger.error(`Error setting up trade, exiting.`);
    } else {
      logger.error(`Error in main loop: ${error}`);
      logger.error(error);
      logger.error(`Error in main loop: ${error.stack}`);
      send_message(`${pair}: Error in main loop: ${error}`);
    }
    soft_exit();
  });
}

// TODO: exceptions
main().catch(error => {
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
  soft_exit(1);
});

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code) {
  if (algo) algo.shutdown_streams();
  if (exit_code) process.exitCode = exit_code;
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
