const async_error_handler = require("../lib/async_error_handler");
const { ExitNow } = require("../lib/errors");
const BigNumber = require("bignumber.js");
const utils = require("../lib/utils");
const assert = require("assert");
const TradeExecutor = require("../lib/trade_executor");

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
  throw Error("BigNumber .valueOf called!");
};

class Algo {
  // All numbers are expected to be passed in as strings
  constructor(args = {}) {
    // Map command line args to original TradeExecutor arguments
    let {
      send_message,
      logger,
      trade_state,
      base_amount, // can be either the amount to buy or sell depending on other args
      buy_price
    } = args;

    let te_args = args;

    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;

    assert(trade_state);
    this.trade_state = trade_state;

    this.logger.warn(`WARNING -a is UNTESTED in this CODE`);

    if (buy_price) {
      if (base_amount) te_args.base_amount_to_buy = BigNumber(base_amount);
    } else {
      if (base_amount) te_args.base_amount_held = BigNumber(base_amount);
    }
    delete te_args.base_amount;

    this.trade_executor = new TradeExecutor(te_args);
  }

  async main() {
    try {
      await this.trade_executor.main();
    } catch (error) {
      async_error_handler(this.logger, `trade_executor.main`, error);
    }
  }
}
module.exports = Algo;
