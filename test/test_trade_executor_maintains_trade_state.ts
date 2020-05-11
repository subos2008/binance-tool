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
import { create_new_trade, build_trade_state_for_trade_id, TradeState } from "../classes/persistent_state/redis_trade_state";
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
  allowed_to_trade_without_stop: true,
  max_portfolio_percentage_per_trade: new BigNumber(100)
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
  if (buy) { expect(await trade_state.get_buyOrderId(), "expected buyOrderId to be set").not.to.be.undefined }
  else { expect(await trade_state.get_buyOrderId(), "buyOrderId has value when undefined expected").to.be.undefined }
  if (stop) { expect(await trade_state.get_stopOrderId(), "expected stopyOrderId to be set").not.to.be.undefined }
  else { expect(await trade_state.get_stopOrderId(), "stopOrderId has value when undefined expected").to.be.undefined }
  if (target) { expect(await trade_state.get_targetOrderId(), "expected targetOrderId to be set").not.to.be.undefined }
  else { expect(await trade_state.get_targetOrderId(), "targetOrderId has value when undefined expected").to.be.undefined }
}

describe("TradeExecutor Maintains TradeState", function () {
  describe("Given an open position", function () {
    async function setup(overrides: { td_config?: any, logger?: Logger } = {}) {
      const logger : Logger = overrides.logger ? overrides.logger : null_logger
      let trade_definition = new TradeDefinition(logger, Object.assign({
        pair: default_pair,
        max_quote_amount_to_buy,
        buy_price, stop_price, target_price,
        soft_entry: true, auto_size: true
      }, overrides.td_config || {}), exchange_info)
      const trade_id = await create_new_trade({ redis, logger, trade_definition })
      const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger });

      let ee = new ExchangeEmulator({ starting_balances, logger, exchange_info });

      const order_state = new OrderState({ redis, logger })

      let trade_executor = new TradeExecutor({
        logger, ee, send_message: fresh_message_queue(),
        percentage_before_soft_buy_price_to_add_order,
        trading_rules: permissive_trading_rules,
        trade_state, order_state, trade_definition
      });

      await trade_executor.main()

      return { trade_state, trade_definition, trade_executor, ee }
    }
    describe("Fresh trade with a buy_price", function () {
      describe("Before the buy trigger price is hit", function () {
        it('Sets buying_allowed to true', async function () {
          let { trade_state } = await setup()
          expect(await trade_state.get_buying_allowed()).to.be.true
        })
        it('the target position size is undefined', async function () {
          let { trade_state } = await setup()
          expect(await trade_state.get_target_base_amount_to_buy()).to.be.undefined
        })
        it('buyOrderId is undefined', async function () {
          let { trade_state } = await setup()
          await check_orders(trade_state, { buy: false })
        })
      })
      describe("When the buy trigger price is hit", function () {
        it('Sets target_base_amount_to_buy', async function () {
          let { trade_state, ee } = await setup()
          await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
          expect(await trade_state.get_target_base_amount_to_buy()).not.to.be.undefined
        })
        it('Sets the buyOrderId', async function () {
          let { trade_state, ee } = await setup()
          await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
          await check_orders(trade_state, { buy: true })
        })
      })
      describe("When the buy order has completed", function () {
        it('Sets stopOrderId', async function () {
          let { trade_state, ee } = await setup()
          await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
          await ee.set_current_price({ symbol: default_pair, price: new BigNumber(buy_price) });
          expect(await trade_state.get_stopOrderId(), "expected stopOrderId to be set").not.to.be.undefined
        })
        it('Unsets the buyOrderId', async function () {
          let { trade_state, ee } = await setup()
          await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
          await ee.set_current_price({ symbol: default_pair, price: new BigNumber(buy_price) });
          expect(await trade_state.get_buyOrderId(), "buyOrderId has value when undefined expected").to.be.undefined
        })
        it('Sets buying_allowed to false', async function () {
          let { trade_state, ee } = await setup()
          await ee.set_current_price({ symbol: default_pair, price: buy_order_trigger_price });
          await ee.set_current_price({ symbol: default_pair, price: new BigNumber(buy_price) });
          expect(await trade_state.get_buying_allowed()).to.be.false
        })
      })
      describe("When soft_entry is false", function () {
        it("base_amount_held is zero", async function () {
          let { trade_state } = await setup({ td_config: { soft_entry: false } })
          expect(await trade_state.get_base_amount_held()).to.bignumber.equal(0)
        })
        it('Sets target_base_amount_to_buy', async function () {
          let { trade_state } = await setup({ td_config: { soft_entry: false } })
          expect(await trade_state.get_target_base_amount_to_buy()).not.to.be.undefined
        })
        it('Sets the buyOrderId', async function () {
          let { trade_state } = await setup({ td_config: { soft_entry: false } })
          await check_orders(trade_state, { buy: true })
        })
      })
    })
  })
})
