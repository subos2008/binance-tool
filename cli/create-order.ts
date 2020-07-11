#!./node_modules/.bin/ts-node

import { OrderCreator } from "../classes/order_creator";
import { AlgoUtils } from "../service_lib/algo_utils"
import { TradeState } from '../classes/persistent_state/redis_trade_state'
const Binance = require("binance-api-node").default;

require("dotenv").config();

const Logger = require("../lib/faux_logger");
const logger = new Logger({ silent: false });

import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: "https://ebe019da62da46189b217c476ec1ab62@o369902.ingest.sentry.io/5326470"
});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", "cli");
  scope.setTag("cli", "create-order");
});

const { promisify } = require("util");

const yargs = require("yargs");

async function sorted_trade_ids() {
  console.log(`Examining redis...`)
  const redis = require("redis").createClient({
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD
  });
  const keysAsync = promisify(redis.keys).bind(redis);
  const keys = await keysAsync("trades:*:completed");
  console.log(`Finished examining redis.`)
  redis.quit();
  return keys.map((key: any) => parseInt(key.match(/:(\d+):/)[1])).sort((a: any, b: any) => a - b)
}

async function main() {
  yargs
    .strict()
    .command(
      ["market-buy"],
      "Create an order and link to a trade-id to adjust that trades position size",
      {
        'trade-id': {
          description: "trade id",
          type: "string",
          demandOption: false,
          choices: (await sorted_trade_ids()).map((n: number) => n.toString()),
        },
        'pair': {
          description: "Exchange symbol",
          type: "string",
          demandOption: true,
        },
        'base-amount': {
          description: "Base amount to buy (i.e. BTC in BTCUSDT)",
          type: "string",
          demandOption: true,
        },
      },
      create_market_buy
    )
    .command(
      ["market-sell"],
      "Create an order and link to a trade-id to adjust that trades position size",
      {
        'trade-id': {
          description: "trade id",
          type: "string",
          demandOption: false,
          choices: (await sorted_trade_ids()).map((n: number) => n.toString()),
        },
        'pair': {
          description: "Exchange symbol",
          type: "string",
          demandOption: true,
        },
        'base-amount': {
          description: "Base amount to sell (i.e. BTC in BTCUSDT)",
          type: "string",
          demandOption: true,
        },
      },
      create_market_sell
    )
    .showHelpOnFail(true)
    // .command({
    //   command: '*',
    //   handler() {
    //     yargs.showHelp()
    //   }
    // })
    .demandCommand()
    .help(
      'help',
      'Show usage instructions.'
    )
    .argv
}
main().then(() => { });

async function connect() {
  logger.info("Live trading mode");
  const ee = Binance({
    apiKey: process.env.APIKEY,
    apiSecret: process.env.APISECRET
  });

  const algo_utils = new AlgoUtils({ logger, ee });
  let exchange_info = await ee.exchangeInfo();
  algo_utils.set_exchange_info(exchange_info)

  const redis = require("redis").createClient({
    host: process.env.REDIS_HOST,
    password: process.env.REDIS_PASSWORD
  });
  let order_creator = new OrderCreator(logger, redis, algo_utils)
  return { redis, order_creator }
}

async function create_market_sell(argv: any) {
  let trade_id = argv['trade-id']
  let pair = argv['pair']
  let base_amount = argv['base-amount']

  let { redis, order_creator } = await connect()

  let trade_state = trade_id ? new TradeState({ logger, redis, trade_id }) : undefined

  await order_creator.market_sell({ trade_state, pair, base_amount })

  redis.quit();
}

async function create_market_buy(argv: any) {
  let trade_id = argv['trade-id']
  let pair = argv['pair']
  let base_amount = argv['base-amount']

  let { redis, order_creator } = await connect()

  let trade_state = trade_id ? new TradeState({ logger, redis, trade_id }) : undefined

  await order_creator.market_buy({ trade_state, pair, base_amount })

  redis.quit();
}
