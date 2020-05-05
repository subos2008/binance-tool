/// <reference types="../chai-bignumber" />

import { expect } from 'chai'
import * as chai from 'chai'

const chaiBignumber = require("chai-bignumber");

chai.use(chaiBignumber());

import BigNumber from "bignumber.js";

import { ExchangeEmulator } from "../lib/exchange_emulator";
import { TradeDefinition } from "../classes/specifications/trade_definition";
const Logger = require("../lib/faux_logger");
import { OrderState } from "../classes/persistent_state/redis_order_state"

const fs = require("fs");
import { TradeExecutor } from "../lib/trade_executor"
import { initialiser as trade_state_initialiser, TradeState } from "../classes/persistent_state/redis_trade_state";
import { Logger } from '../interfaces/logger';
import { RedisClient } from 'redis';

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

const default_base_currency = "ETH";
const default_quote_currency = "BTC";
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(
  fs.readFileSync("./test/exchange_info.json", "utf8")
);

const permissive_trading_rules = {
  max_allowed_portfolio_loss_percentage_per_trade: new BigNumber(100),
  allowed_to_trade_without_stop: true
};

let default_stop_limt_price_factor = new BigNumber("0.8"); // hard coded default in algo atm

let message_queue: string[] = [];
// returns a send_message function
function fresh_message_queue() {
  message_queue = [];
  return (msg: string) => {
    message_queue.push(msg);
  };
}

function most_recent_message() {
  return message_queue[message_queue.length - 1];
}

var redis: RedisClient = require("redis-mock").createClient();
beforeEach(function () {
  // empty
});

afterEach(function (done) {
  redis.flushall();
  redis.quit(done);
});

const target_price = "100"
const buy_price = "50"
const stop_price = "40"
const mid_range_price = new BigNumber("75") // derived
const max_quote_amount_to_buy = '1'
const percentage_before_soft_buy_price_to_add_order = new BigNumber(1)
const buy_order_trigger_price = new BigNumber(buy_price).times(
  new BigNumber(100)
    .plus(percentage_before_soft_buy_price_to_add_order)
    .div(100)
)
const total_base_amount_bought = new BigNumber(max_quote_amount_to_buy).dividedBy(buy_price)
const starting_balances: { [currency: string]: BigNumber } = {};
starting_balances[default_quote_currency] = new BigNumber('1000')
starting_balances[default_base_currency] = new BigNumber('1000')

async function check_orders(trade_state: TradeState, { buy, target, stop }: { buy?: boolean, target?: boolean, stop?: boolean }) {
  if (buy) { expect(await trade_state.get_buyOrderId()).not.to.be.undefined }
  else { expect(await trade_state.get_buyOrderId()).to.be.undefined }
  if (stop) { expect(await trade_state.get_stopOrderId()).not.to.be.undefined }
  else { expect(await trade_state.get_stopOrderId()).to.be.undefined }
  if (target) { expect(await trade_state.get_targetOrderId()).not.to.be.undefined }
  else { expect(await trade_state.get_targetOrderId()).to.be.undefined }

}

describe("TradeExecutor Restarting", function () {
  describe("Given an open position", function () {
    async function setup() {
      // let logger: Logger = null_logger
      let trade_definition = new TradeDefinition(logger, {
        pair: default_pair,
        max_quote_amount_to_buy,
        buy_price, stop_price, target_price,
        soft_entry: true, auto_size: true
      }, exchange_info)
      const trade_state = await trade_state_initialiser(
        Object.assign({ trade_id: '1', redis, logger: null_logger }, { trade_definition })
      );

      let ee = new ExchangeEmulator({ starting_balances, logger, exchange_info });

      const order_state = new OrderState({ redis, logger })

      let trade_executor = new TradeExecutor({
        logger, ee, send_message: fresh_message_queue(),
        percentage_before_soft_buy_price_to_add_order,
        trading_rules: permissive_trading_rules,
        trade_state, order_state, trade_definition
      });

      return { trade_state, trade_definition, trade_executor, ee }
    }
    async function setup_filled_buy_order() {
      let { trade_state, trade_definition, trade_executor, ee } = await setup()
      await trade_state.add_buy_order({ orderId: '1' })
      await trade_state.fully_filled_buy_order({ orderId: '1', total_base_amount_bought })
      return { trade_state, trade_definition, trade_executor, ee }
    }
    describe("When the buyOrder has fully executed", function () {
      it("base_amount_held is the expected amount", async function () {
        let { trade_state } = await setup_filled_buy_order()
        expect(await trade_state.get_base_amount_held()).to.bignumber.equal(total_base_amount_bought)
      })
      it("doesn't create another buy order if the price hits the buy price", async function () {
        let { trade_state, trade_executor, ee } = await setup_filled_buy_order()
        await trade_executor.main()
        await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
        await check_orders(trade_state, { buy: false })
      })
      // TODO: ok so we fork out here:
      //  1. there are no orders, say stop/targetOrder creation borked out
      //  2. there is a stopOrder, the ususal case
      //  3. there is a targetOrder
      //  4. Advanced: there is a stop and a target order
      describe("And no sell orders are present", function () {
        it("creates a limit stopOrder if the price is mid-range", async function () {
          let { trade_state, trade_executor, ee } = await setup_filled_buy_order()
          await check_orders(trade_state, { stop: false })
          await trade_executor.main()
          await ee.set_current_price({ symbol: default_pair, price: mid_range_price });
          await check_orders(trade_state, { stop: true })
        })
        it("creates a limit stopOrder if the price is near the stop_price")
        it("does something if the price is at/below the stop_price")
        it("creates a limit targetOrder if the price is near the target_price")
        it("does something if the price is at/above the target_price")
      })
      describe("And the stopOrder is present", function () {
        it("does nothing if the price is mid-range", async function () {
          let { trade_state, trade_executor } = await setup_filled_buy_order()
          await trade_state.add_stop_order({ orderId: '1' })
          await trade_executor.main()
          await check_orders(trade_state, { stop: true })
        })
        it("completes the trade if the price hits stop_price")
        describe("And the price approaches target_price", function () {
          it("moves the order to the targetOrder")
          describe("And the price hits target_price", function () {
            it("completes the trade")
          })
        })
      })
      describe("And the targetOrder is present", function () {
        it("moves mirrors the tests for the stop phase")
      })
    })
    // For errors killing the system creating the buyOrder
    // so there's no buyOrder id in trade_state and the amount_bought is 0
    // system can decide how much to buy 
    // what is there is no buyOrderId and the amount_bought is non-zero?
    // would be easier if we stor the target amount to buy at trade creation
    describe("When there is no buyOrder", function () {
      it('create tests')
    })
    describe("When the buyOrder exists and potentially executed?", function () {
      it('create tests')
    })
  })
})
