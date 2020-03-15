"use strict";
const chai = require("chai");
chai.use(require("chai-bignumber")());
const expect = chai.expect;

const BigNumber = require("bignumber.js");

const ExchangeEmulator = require("../lib/exchange_emulator");
const TradeDefinition = require("../classes/trade_definition");
const Logger = require("../lib/faux_logger");
const {
  NotImplementedError,
  InsufficientBalanceError
} = require("../lib/errors");
// const async_error_handler = require('../lib/async_error_handler');
const utils = require("../lib/utils");
const fs = require("fs");
const TradeExecutor = require("../lib/trade_executor");
const TradeState = require("../classes/redis_trade_state");

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

// Tests needed:
// .exchangeInfo
// .order(args)
// .ws.aggTrades([ pair ], (trade) => {
// .ws.user((data) => {

const default_base_currency = "ETH";
const default_quote_currency = "BTC";
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(
  fs.readFileSync("./test/exchange_info.json", "utf8")
);

const permissive_trading_rules = {
  max_allowed_portfolio_loss_percentage_per_trade: BigNumber(100),
  allowed_to_trade_without_stop: true
};

let default_stop_limt_price_factor = BigNumber("0.8"); // hard coded default in algo atm

let message_queue = [];
function fresh_message_queue() {
  message_queue = [];
  return msg => {
    message_queue.push(msg);
  };
}

function most_recent_message() {
  return message_queue[message_queue.length - 1];
}

function aggrivate_price(price) {
  return BigNumber(price).plus("0.00000001"); // will trigger the PRICE_FILTER unless prices are munged
}
function aggrivate_amount(base_amount) {
  return BigNumber(base_amount).plus(".0001"); // will trigger the LOT_SIZE unless base_amount is munged
}
var redis;
beforeEach(function() {
  redis = require("redis-mock").createClient();
});

afterEach(function(done) {
  redis.flushall();
  redis.quit(done);
});

describe("TradeExecutor", function() {
  function setup({ algo_config, ee_config, no_agitate } = {}) {
    ee_config = Object.assign(
      {
        logger: null_logger,
        exchange_info
      },
      ee_config
    );
    if (ee_config.starting_quote_balance || ee_config.starting_base_balance) {
      ee_config.starting_balances = {};
    }
    if (ee_config.starting_quote_balance) {
      ee_config.starting_balances[default_quote_currency] =
        ee_config.starting_quote_balance;
    } else {
      if (!ee_config.starting_balances) {
        ee_config.starting_balances = {};
        ee_config.starting_balances[default_quote_currency] = BigNumber(1);
      }
    }
    if (ee_config.starting_base_balance)
      ee_config.starting_balances[default_base_currency] =
        ee_config.starting_base_balance;
    let ee = new ExchangeEmulator(ee_config);

    const trade_state = new TradeState(
      Object.assign({ trade_id: 1, redis, logger: null_logger }, algo_config)
    );
    algo_config = Object.assign(
      {},
      {
        ee,
        logger: null_logger,
        send_message: fresh_message_queue(),
        trading_rules: permissive_trading_rules
      },
      algo_config,
      { trade_state }
    );
    if (!algo_config.pair && !algo_config.virtualPair) {
      algo_config.pair = default_pair;
    }
    if (!no_agitate) {
      if (algo_config.buy_price)
        algo_config.buy_price = aggrivate_price(algo_config.buy_price);
      if (algo_config.stop_price)
        algo_config.stop_price = aggrivate_price(algo_config.stop_price);
      if (algo_config.limit_price)
        algo_config.limit_price = aggrivate_price(algo_config.limit_price);
      if (algo_config.target_price)
        algo_config.target_price = aggrivate_price(algo_config.target_price);
      if (algo_config.base_amount_to_buy)
        algo_config.base_amount_to_buy = aggrivate_amount(
          algo_config.base_amount_to_buy
        );
      if (algo_config.base_amount_held)
        algo_config.base_amount_held = aggrivate_amount(
          algo_config.base_amount_held
        );
      if (algo_config.max_quote_amount_to_buy)
        algo_config.max_quote_amount_to_buy = aggrivate_amount(
          algo_config.max_quote_amount_to_buy
        );
    }
    algo_config.trade_definition = new TradeDefinition(algo_config);
    let algo = new TradeExecutor(algo_config);
    return { algo, ee };
  }

  describe("constructor", function() {
    it.skip("does some stuff", function() {
      // let ee = setup_ee();
      // expect(ee.quote_coin_balance_not_in_orders.isEqualTo(starting_quote_balance)).to.equal(true);
    });
  });

  describe("soft enwhen a buy_price, stop_price and target_price present", function() {
    it(
      "if it hits target price while buyOrder is still open then it cancels buy and places targetOrder if partially filled"
    );
    it(
      "what happens if I get a partial stop fill then hit target? base_amount_to_buy needs to be dynamic, right?"
    );
    describe("without soft entry", function() {
      describe("when base_amount_to_buy is supplied", function() {
        it("creates a stop limit sell order after the buy order hits", async function() {
          const base_amount_to_buy = BigNumber(1);
          const buy_price = BigNumber(1);
          const stop_price = buy_price.times("0.5");
          const target_price = buy_price.times(2);
          let { ee, algo } = setup({
            algo_config: {
              pair: default_pair,
              base_amount_to_buy,
              buy_price,
              target_price,
              stop_price
            }
          });
          try {
            await algo.main();
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            });
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          let limit_price = stop_price.times(default_stop_limt_price_factor);
          expect(await algo.trade_state.get_stopOrderId()).to.equal(2);
          expect(ee.open_orders).to.have.lengthOf(1);
          expect(ee.open_orders[0].type).to.equal("STOP_LOSS_LIMIT");
          expect(ee.open_orders[0].side).to.equal("SELL");
          expect(ee.open_orders[0].orderId).to.equal(2);
          expect(ee.open_orders[0].price).to.bignumber.equal(limit_price);
          expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(
            true
          );
          expect(
            ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)
          ).to.equal(true);

          try {
            await ee.set_current_price({
              symbol: default_pair,
              price: stop_price
            }); // trigger setting of stop
            await ee.set_current_price({
              symbol: default_pair,
              price: limit_price
            }); // fill stop order
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.be.an("string");
          expect(most_recent_message()).to.equal(
            `${default_pair} stop loss order filled`
          );
        });
        it("creates a limit sell order at the target_price when that price is hit", async function() {
          // TODO: also check that it cancels the stop order?
          // TODO: Sends a message?
          // TODO: what if we retrace to the stop price before the order is filled?
          // TODO: what if the target_price limit order gets partially filled and then we retrace to the stop price?
          const base_amount_to_buy = BigNumber(1);
          const buy_price = BigNumber(1);
          const stop_price = buy_price.times("0.5");
          const target_price = buy_price.times(2);
          let { ee, algo } = setup({
            algo_config: {
              pair: default_pair,
              base_amount_to_buy,
              buy_price,
              target_price,
              stop_price
            }
          });
          try {
            await algo.main();
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            });
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.be.an("string");
          expect(most_recent_message()).to.equal(
            `${default_pair} buy order filled`
          );

          try {
            // Note that as part of hitting the target_price the algo will cancel the stopOrder,
            // which involves an await, hence why we await on set_current_price
            await ee.set_current_price({
              symbol: default_pair,
              price: target_price
            });
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(await algo.trade_state.get_stopOrderId()).to.be.undefined;
          expect(await algo.trade_state.get_targetOrderId()).to.equal(3);
          expect(ee.open_orders).to.have.lengthOf(1);
          expect(ee.open_orders[0].type).to.equal("LIMIT");
          expect(ee.open_orders[0].side).to.equal("SELL");
          expect(ee.open_orders[0].orderId).to.equal(3);
          expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(
            true
          );
          expect(
            ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)
          ).to.equal(true);

          try {
            await ee.set_current_price({
              symbol: default_pair,
              price: target_price
            }); // a second time to trigger the LIMIT SELL
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.equal(
            `${default_pair} target sell order filled`
          );
        });
      });
      it(
        "creates a stop order again when price moves from target price back to stop price"
      );
    });
    describe("with soft entry", function() {
      it("doesnt buy if price is below the stop_price");
      describe("when base_amount_to_buy is supplied", function() {
        it("creates a limit buy order only after the buy price hits", async function() {
          const base_amount_to_buy = BigNumber(1);
          const buy_price = BigNumber(1);
          const stop_price = buy_price.times("0.5");
          const target_price = buy_price.times(2);
          let { ee, algo } = setup({
            algo_config: {
              pair: default_pair,
              base_amount_to_buy,
              buy_price,
              target_price,
              stop_price,
              soft_entry: true
            }
          });
          try {
            await algo.main();
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(ee.open_orders).to.have.lengthOf(0);

          try {
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            }); // once to trigger soft entry
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(await algo.trade_state.get_buyOrderId()).to.equal(1);
          expect(ee.open_orders).to.have.lengthOf(1);
          expect(ee.open_orders[0].type).to.equal("LIMIT");
          expect(ee.open_orders[0].side).to.equal("BUY");
          expect(ee.open_orders[0].orderId).to.equal(1);
          expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
          expect(
            ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)
          ).to.equal(true);
          expect(most_recent_message()).to.be.an("string");
          expect(most_recent_message()).to.equal(
            `${default_pair} soft entry buy order trigger price hit`
          );
        });

        it("creates a stop limit sell order after the buy order hits, and sends a message when the stop fills", async function() {
          const base_amount_to_buy = BigNumber(1);
          const buy_price = BigNumber(1);
          const stop_price = buy_price.times("0.5");
          const target_price = buy_price.times(2);
          let { ee, algo } = setup({
            algo_config: {
              pair: default_pair,
              base_amount_to_buy,
              buy_price,
              target_price,
              stop_price,
              soft_entry: true
            }
          });
          try {
            await algo.main();
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            }); // once to trigger soft entry
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            }); // twice to fill order
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(await algo.trade_state.get_stopOrderId()).to.equal(2);
          expect(ee.open_orders).to.have.lengthOf(1);
          expect(ee.open_orders[0].type).to.equal("STOP_LOSS_LIMIT");
          expect(ee.open_orders[0].side).to.equal("SELL");
          expect(ee.open_orders[0].orderId).to.equal(2);
          expect(ee.open_orders[0].price).to.bignumber.equal(
            stop_price.times(default_stop_limt_price_factor)
          );
          expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(
            true
          );
          expect(
            ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)
          ).to.equal(true);

          let limit_price = stop_price.times(default_stop_limt_price_factor);
          try {
            await ee.set_current_price({
              symbol: default_pair,
              price: stop_price
            }); // trigger stop creation
            await ee.set_current_price({
              symbol: default_pair,
              price: limit_price
            }); // fill stop order
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.be.an("string");
          expect(most_recent_message()).to.equal(
            `${default_pair} stop loss order filled`
          );
        });
        it("creates a limit sell order at the target_price when that price is hit", async function() {
          // TODO: also check that it cancels the stop order?
          // TODO: Sends a message?
          // TODO: what if we retrace to the stop price before the order is filled?
          // TODO: what if the target_price limit order gets partially filled and then we retrace to the stop price?
          const base_amount_to_buy = BigNumber(1);
          const buy_price = BigNumber(1);
          const stop_price = buy_price.times("0.5");
          const target_price = buy_price.times(2);
          let { ee, algo } = setup({
            algo_config: {
              pair: default_pair,
              base_amount_to_buy,
              buy_price,
              target_price,
              stop_price,
              soft_entry: true
            }
          });
          try {
            await algo.main();
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            }); // once to trigger soft entry
            await ee.set_current_price({
              symbol: default_pair,
              price: buy_price
            }); // twice to fill order
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.be.an("string");
          expect(most_recent_message()).to.equal(
            `${default_pair} buy order filled`
          );

          try {
            // Note that as part of hitting the target_price the algo will cancel the stopOrder,
            // which involves an await, hence why we await on set_current_price
            await ee.set_current_price({
              symbol: default_pair,
              price: target_price
            });
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(await algo.trade_state.get_targetOrderId()).to.equal(3);
          expect(ee.open_orders).to.have.lengthOf(1);
          expect(ee.open_orders[0].type).to.equal("LIMIT");
          expect(ee.open_orders[0].side).to.equal("SELL");
          expect(ee.open_orders[0].orderId).to.equal(3);
          expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(
            true
          );
          expect(
            ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)
          ).to.equal(true);

          try {
            await ee.set_current_price({
              symbol: default_pair,
              price: target_price
            }); // a second time to trigger the LIMIT SELL
          } catch (e) {
            console.log(e);
            expect.fail("should not get here: expected call not to throw");
          }
          expect(most_recent_message()).to.equal(
            `${default_pair} target sell order filled`
          );
        });
      });
    });
  });
});
