#!./node_modules/.bin/ts-node

const Logger = require("./lib/faux_logger");
// Initial logger, we re-create it below once we have the trade_id
var logger = new Logger({ silent: false });
require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: "https://5f5398dfd6b0475ea6061cf39bc4ed03@sentry.io/5178400"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "binance-tool");
});

require('make-promises-safe') // installs an 'unhandledRejection' handler

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

import { get_redis_client, set_redis_logger } from "./lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

const { promisify } = require("util");
const hgetallAsync = promisify(redis.hgetall).bind(redis);
const Binance = require("binance-api-node").default;

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

Sentry.configureScope(function (scope: any) {
  scope.setTag("trade-id", trade_id);
  scope.setUser({ id: trade_id });
});

logger = new Logger({ silent: false, template: { trade_id } });
const send_message = require("./lib/telegram")(`binance-tool (${trade_id}): `);

import { TradeExecutor } from "./lib/trade_executor"
const BigNumber = require("bignumber.js");
import { TradingRules } from "./lib/trading_rules"
import { build_trade_state_for_trade_id } from "./classes/persistent_state/redis_trade_state"
import { OrderState } from "./classes/persistent_state/redis_order_state"
import { TradeDefinition } from "./classes/specifications/trade_definition";
import { ExchangeEmulator } from "./lib/exchange_emulator"

process.on("unhandledRejection", up => {
  send_message(`UnhandledPromiseRejection: ${up}`);
  throw up;
});

// TODO: load from shared yaml file with binance.js
// eg: const vars = YAML.parse(fs.readFileSync(process.env.VARS_INPUT_FILENAME, 'utf8'));
// with: const YAML = require('yaml');
logger.info("Warning trading rules hardcoded twice");
const trading_rules = new TradingRules({
  max_allowed_portfolio_loss_percentage_per_trade: BigNumber("1.5"),
  allowed_to_trade_without_stop: true,
  // Diversification is the only free lunch on wallstreet
  max_portfolio_percentage_per_trade: BigNumber("15")
});

var trade_executor: TradeExecutor;

async function main() {
  const redis_trade_definition = await hgetallAsync(
    `trades:${trade_id}:trade_definition`
  );

  logger.info(`From redis:`);
  logger.info(redis_trade_definition);

  if (redis_trade_definition === null) {
    logger.error(`Got null from Redis. Trade ${trade_id} likely doesn't exist`);
    throw new Error(`Got null from Redis. Trade ${trade_id} likely doesn't exist`)
  }

  const trade_definition = new TradeDefinition(logger, redis_trade_definition);

  const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger });
  await trade_state.print();

  const trade_completed = await trade_state.get_trade_completed();
  logger.info(`trade_completed=${trade_completed}`);
  if (trade_completed) {
    logger.info(`WARNING: trade ${trade_id} is already marked as completed`);
    logger.info(`exiting`);
    process.exit(0);
  }

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
    ee = new ExchangeEmulator(ee_config);
  }


  const order_state = new OrderState({ redis, logger })

  let trade_executor = new TradeExecutor({
    logger, ee, send_message,
    trading_rules,
    trade_state, order_state, trade_definition
  });

  const execSync = require("child_process").execSync;
  execSync("date -u");

  try {
    await trade_executor.main()
  } catch (error) {
    Sentry.captureException(error)
    if (error.name && error.name === "FetchError") {
      logger.error(
        `${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`
      );
      send_message(`${trade_definition.pair}: Error in main loop: ${error}`);
    }
    soft_exit(1);
  };
}

// TODO: exceptions
main().catch(error => {
  Sentry.captureException(error);
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
  soft_exit(1);
});

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code?: number | undefined) {
  redis.quit();
  if (trade_executor) trade_executor.shutdown_streams();
  if (exit_code) process.exitCode = exit_code;
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
