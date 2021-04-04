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

const update_portfolio_from_exchange_interval_seconds: number = Number(process.env.UPDATE_PORTFOLIO_FROM_EXCHANGE_INTERVAL_SECONDS) || (6 * 60 * 60)

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

process.on("unhandledRejection", error => {
  logger.error(error)
  send_message(`UnhandledPromiseRejection: ${error}`);
});

const Binance = require("binance-api-node").default;
import { ExchangeEmulator } from "../lib/exchange_emulator";
import { PortfolioPublisher } from "../classes/amqp/portfolio-publisher";
import { PortfolioUtils } from "../classes/utils/portfolio-utils";
import { Portfolio } from '../interfaces/portfolio';
import { OrderExecutionTracker } from "../service_lib/order_execution_tracker";
import { BinanceOrderData } from '../interfaces/order_callbacks'

const publisher = new PortfolioPublisher({ logger, send_message, broker_name: 'binance' })
let order_execution_tracker: OrderExecutionTracker | null = null

async function update_portfolio_from_exchange(): Promise<void> {
  try {
    const portfolio = await portfolio_tracker.current_portfolio_with_prices()
    try {
      let msg = `B: ${portfolio.btc_value}, U: ${portfolio.usd_value}`;
      try {
        msg += ' as ' + portfolio_utils.balances_to_string(portfolio, "BTC")
      } catch (err) {
        Sentry.captureException(err)
        logger.error(err)
      }
      send_message(msg)
    } catch (err) {
      Sentry.captureException(err)
      logger.error(err)
    }

    try {
      await publisher.publish(portfolio)
    } catch (err) {
      Sentry.captureException(err)
      logger.error(err)
    }
  } catch (err) {
    Sentry.captureException(err)
    logger.error(err)
  }
}
class MyOrderCallbacks {
  send_message: Function;
  logger: Logger;

  constructor({
    send_message,
    logger,
  }: { send_message: (msg: string) => void, logger: Logger }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
  }

  async order_cancelled(order_id: string, data: BinanceOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} cancelled.`)
  }
  async order_filled(order_id: string, data: BinanceOrderData): Promise<void> {
    this.logger.info(`${data.side} order on ${data.symbol} filled.`)
    update_portfolio_from_exchange()
  }
  async order_filled_or_partially_filled(order_id: string, data: BinanceOrderData): Promise<void> {
    // this.logger.info(`${data.side} order on ${data.symbol} filled_or_partially_filled.`)
  }
}

class PortfolioTracker {
  send_message: Function;
  logger: Logger;
  ee: any;
  portfolio: Portfolio = {}

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
      this.portfolio.prices = await this.ee.prices();
    } catch (error) {
      Sentry.captureException(error);
      throw error
    }
  }

  async get_balances_from_exchange() {
    try {
      let response = await this.ee.accountInfo();
      this.portfolio.balances = response.balances;
    } catch (error) {
      Sentry.captureException(error);
      throw error
    }
  }

  async current_portfolio_with_prices(): Promise<Portfolio> {
    await portfolio_tracker.get_balances_from_exchange()
    await portfolio_tracker.get_prices_from_exchange()
    this.portfolio.btc_value = (await portfolio_utils.calculate_portfolio_value_in_quote_currency({ quote_currency: 'BTC', portfolio: this.portfolio })).total.toFixed(8)
    this.portfolio.usd_value = (await portfolio_utils.calculate_portfolio_value_in_quote_currency({ quote_currency: 'USDT', portfolio: this.portfolio })).total.toFixed(2)
    return this.portfolio
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

let ee: Object;
let portfolio_tracker: PortfolioTracker;
const portfolio_utils: PortfolioUtils = new PortfolioUtils({ logger, sentry: Sentry })

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

  // Update on intervals
  update_portfolio_from_exchange()
  setInterval(update_portfolio_from_exchange, update_portfolio_from_exchange_interval_seconds * 1000);

  // Update when any order completes
  let order_callbacks = new MyOrderCallbacks({ logger, send_message })
  order_execution_tracker = new OrderExecutionTracker({
    ee,
    send_message,
    logger,
    order_callbacks
  })
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
  logger.warn(`soft_exit called, exit_code: ${exit_code}`)
  if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
  if (exit_code) process.exitCode = exit_code;
  if (publisher) publisher.shutdown_streams()
  // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}
