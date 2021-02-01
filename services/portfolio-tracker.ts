#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

// portfolio-tracker service: maintains the current portfolio by 
// getting the portfolio on startup and then monitoring the streams
// and tracking deltas. 
//
// On changes:
//  1. Publishes to telegram
//  2. Publishes to nw
//  3. Updates UI on any connected web-streams
//
// Provides API/Events for:
//  1. Current portfolio and portfolio value in a given unit (BTC, USDT)
//     To assist the position-sizer
//  2. Publishes events when the portfolio changes
//  3. Webstream maybe for subscribing to changes? Could also be done by 
//     servers watching the AMQP events
// 
// Thoughts:
//  1. Could also check redis-trades matches position sizes

import { strict as assert } from 'assert';
const service_name = "portfolio-tracker";

const update_portfolio_from_exchange_interval_seconds: number = Number(process.env.UPDATE_PORTFOLIO_FROM_EXCHANGE_INTERVAL_SECONDS) || (24 * 60 * 60)

const _ = require("lodash");

require("dotenv").config();

import * as Sentry from '@sentry/node';
Sentry.init({});
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name);
});

// redis + events publishing + binance

// TODO: periodically verify we have the same local values as the exchange
//        - report to sentry if we are out of sync

// TODO:
// 1. Take initial portfolio code from the position sizer
// 2. Add stream watching code from the order tracker
// 3. Maintain portfolio state - probably just in-process
// 4. Publish to telegram when portfolio changes

const send_message = require("../lib/telegram.js")(`${service_name}: `);

import { Logger } from '../interfaces/logger'
const LoggerClass = require("../lib/faux_logger");
const logger: Logger = new LoggerClass({ silent: false });

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

send_message('starting')

require('make-promises-safe') // installs an 'unhandledRejection' handler

import { get_redis_client, set_redis_logger } from "../lib/redis"
set_redis_logger(logger)
const redis = get_redis_client()

const Binance = require("binance-api-node").default;
import { ExchangeEmulator } from "../lib/exchange_emulator";
import { PortfolioPublisher } from "../classes/amqp/portfolio-publisher";
import { OrderExecutionTracker } from "../service_lib/order_execution_tracker";
import { BinanceOrderData } from '../interfaces/order_callbacks'

const publisher = new PortfolioPublisher({ logger, send_message, broker_name: 'binance' })

// let order_execution_tracker: OrderExecutionTracker | null = null

// class MyOrderCallbacks {
//   send_message: Function;
//   logger: Logger;

//   constructor({
//     send_message,
//     logger,
//   }: { send_message: (msg: string) => void, logger: Logger }) {
//     assert(logger);
//     this.logger = logger;
//     assert(send_message);
//     this.send_message = send_message;
//   }

//   async order_cancelled(order_id: string, data: BinanceOrderData): Promise<void> {
//     this.logger.info(`${data.side} order on ${data.symbol} cancelled.`)
//   }
//   async order_filled(order_id: string, data: BinanceOrderData): Promise<void> {
//     this.logger.info(`${data.side} order on ${data.symbol} filled.`)
//   }
//   async order_filled_or_partially_filled(order_id: string, data: BinanceOrderData): Promise<void> {
//     this.logger.info(`${data.side} order on ${data.symbol} filled_or_partially_filled.`)
//   }
// }

class PortfolioTracker {
  send_message: Function;
  logger: Logger;
  ee: any;
  balances: { asset: string, free: string, locked: string }[] = [];
  prices: { [name: string]: string } = {};


  constructor({
    send_message,
    logger, ee
  }: { send_message: (msg: string) => void, logger: Logger, ee: any }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
    assert(ee);
    this.ee = ee;
  }

  async get_prices_from_exchange() {
    try {
      this.prices = await this.ee.prices();
    } catch (error) {
      Sentry.captureException(error);
      throw error
    }
  }

  async get_portfolio_from_exchange() {
    try {
      let response = await this.ee.accountInfo();
      this.balances = response.balances;
    } catch (error) {
      Sentry.captureException(error);
      throw error
    }
  }

  // Get value of one asset in terms of another ()
  // TODO: allow conversions backwards, i.e. USDT to BTC is done via the BTCUSDT pair
  convert_base_to_quote_currency({ base_quantity, base_currency, quote_currency }: { base_quantity: BigNumber, base_currency: string, quote_currency: string }) {
    let pair = `${base_currency}${quote_currency}`;
    if (pair in this.prices) {
      return base_quantity.times(this.prices[pair]);
    } else {
      throw new Error(`Pair ${pair} not available when converting ${base_currency} to ${quote_currency}`)
    }
  }

  async calculate_portfolio_value_in_quote_currency({ quote_currency }: { quote_currency: string }): Promise<{ available: BigNumber, total: BigNumber, unprocessed_balances: string[] }> {
    try {
      let available = new BigNumber(0), // only reflects quote_currency
        total = new BigNumber(0); // running total of all calculable asset values converted to quote_currency
      let unprocessed_balances: string[] = []
      this.balances.forEach((balance: any) => {
        if (balance.asset === quote_currency) {
          available = available.plus(balance.free);
          total = total.plus(balance.free).plus(balance.locked);
        } else {
          // convert coin value to quote_currency if possible, else skip it
          try {
            let value = this.convert_base_to_quote_currency({
              base_quantity: new BigNumber(balance.free).plus(balance.locked),
              base_currency: balance.asset, quote_currency
            })
            total = total.plus(value);
          } catch (e) {
            // Balances we were unable to convert
            unprocessed_balances.push(balance.asset)
          }
        }
      });
      if (unprocessed_balances.length) this.logger.warn(`Non fatal error: unable to convert ${unprocessed_balances.length} assets to ${quote_currency}, skipping`);
      return { available, total, unprocessed_balances };
    } catch (error) {
      Sentry.captureException(error);
      throw error
    }
  }
}

var { argv } = require("yargs")
  .usage("Usage: $0 --live")
  .example("$0 --live")
  // '--live'
  .boolean("live")
  .describe("live", "Trade with real money")
  .default("live", true);
let { live } = argv;

var ee: Object;
var portfolio_tracker: PortfolioTracker;

async function update_portfolio_from_exchange(): Promise<void> {
  try {
    await portfolio_tracker.get_portfolio_from_exchange()
    await portfolio_tracker.get_prices_from_exchange()
    let btc_value = await portfolio_tracker.calculate_portfolio_value_in_quote_currency({ quote_currency: 'BTC' })
    let usd_value = await portfolio_tracker.calculate_portfolio_value_in_quote_currency({ quote_currency: 'USDT' })

    try {
      send_message(`B: ${btc_value.total.toFixed(4)}, U: ${usd_value.total.toFixed(0)}`)
    } catch (err) {
      Sentry.captureException(err)
      logger.error(err)
    }

    try {
      let event = { btc_value: btc_value.total.toFixed(), usd_value: usd_value.total.toFixed() }
      await publisher.publish(event)
    } catch (err) {
      Sentry.captureException(err)
      logger.error(err)
    }

  } catch (err) {
    Sentry.captureException(err)
    logger.error(err)
  }

}

async function main() {
  if (live) {
    logger.info("Live monitoring mode");
    assert(process.env.APIKEY)
    assert(process.env.APISECRET)
    ee = Binance({
      apiKey: process.env.APIKEY,
      apiSecret: process.env.APISECRET
    });
  } else {
    logger.info("Emulated exchange mode");
    const fs = require("fs");
    const exchange_info = JSON.parse(
      fs.readFileSync("./test/exchange_info.json", "utf8")
    );
    let ee_config = {
      starting_balances: {
        USDT: new BigNumber("50")
      },
      logger,
      exchange_info
    };
    ee = new ExchangeEmulator(ee_config);
  }

  const execSync = require("child_process").execSync;
  execSync("date -u");

  portfolio_tracker = new PortfolioTracker({ logger, send_message, ee })

  await publisher.connect()
  update_portfolio_from_exchange()
  setInterval(update_portfolio_from_exchange, update_portfolio_from_exchange_interval_seconds * 1000);
}

main().catch(error => {
  Sentry.captureException(error)
  logger.error(`Error in main loop: ${error}`);
  logger.error(error);
  logger.error(`Error in main loop: ${error.stack}`);
  soft_exit(1);
});

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code: number | null = null) {
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
  if (exit_code) process.exitCode = exit_code;
  if (publisher) publisher.shutdown_streams()
  if (redis) redis.quit();
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
