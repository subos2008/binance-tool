#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require("dotenv").config();

require("./lib/sentry");

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

const redis = require("redis").createClient({
  host: process.env.REDIS_HOST,
  password: process.env.REDIS_PASSWORD
});
const { promisify } = require("util");
const hgetallAsync = promisify(redis.hgetall).bind(redis);
const getAsync = promisify(redis.get).bind(redis);
const Binance = require("binance-api-node").default;
const send_message = require("./lib/telegram.js");
const TradeExecutor = require("./service_lib/trade_executor");
const Logger = require("./lib/faux_logger");
const BigNumber = require("bignumber.js");
const TradingRules = require("./lib/trading_rules");
const TradeState = require("./classes/redis_trade_state");
const TradeDefinition = require("./classes/trade_definition");

const logger = new Logger({ silent: false });

process.on("unhandledRejection", up => {
  send_message(`UnhandledPromiseRejection: ${up}`);
  throw up;
});

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
let { "trade-id": trade_id, live, launch } = argv;
var trade_executor;

async function main() {
  var stringToBool = myValue => myValue === "true";
  const redis_trade_definition = await hgetallAsync(
    `trades:${trade_id}:trade_definition`
  );

  console.log(`From redis:`);
  console.log(redis_trade_definition);

  if (redis_trade_definition === null) {
    logger.error(`Got null from Redis. Trade ${trade_id} likely doesn't exist`);
    soft_exit(1);
    return; // exit
  }

  const trade_definition = new TradeDefinition(redis_trade_definition);
  const trade_state = new TradeState({ logger, redis, trade_id });

  const trade_completed = await trade_state.get_trade_completed();
  console.log(`trade_completed=${trade_completed}`);
  if (trade_completed) {
    console.log(`WARNING: trade ${trade_id} is already marked as completed`);
    console.log(exiting);
    process.exit(0);
  }

  // a neat little hack to get us on the way to restartable jobs,
  // convert the amount bought so far to '-a'
  // Actually no - this just lives in trade_state now
  // fist we will init from it then we will update it
  // does need to be a BigNumber
  // trade_definition.base_amount_held = await trade_state.get_base_amount_held();

  // Pick live or emulated ExecutionEngine/ExchangeEmulator
  var ee;
  if (live) {
    logger.info("Live trading mode");
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET
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

  trade_executor = new TradeExecutor({
    ee,
    send_message,
    logger,
    trade_id,
    trade_state, // dependency injection for persistent state
    trade_definition,
    trading_rules
  });

  const execSync = require("child_process").execSync;
  code = execSync("date -u >&2");

  trade_executor.main().catch(error => {
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
      send_message(`${trade_definition.pair}: Error in main loop: ${error}`);
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
  redis.quit();
  if (trade_executor) trade_executor.shutdown_streams();
  if (exit_code) process.exitCode = exit_code;
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
