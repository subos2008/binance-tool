const assert = require("assert");

// pair,
// max_quote_amount_to_buy,
// buy_price,
// stop_price,
// target_price,
// nonBnbFees,
// soft_entry,
// auto_size
// base_amount, // can be either the amount to buy or sell depending on other args
// base_amount, // depricated

// if (trade_definition.buy_price) {
//   if (trade_definition.base_amount)
//     te_args.base_amount_to_buy = BigNumber(trade_definition.base_amount);
// } else {
//   if (trade_definition.base_amount)
//     te_args.base_amount_held = BigNumber(trade_definition.base_amount);
// }
// delete te_args.base_amount;

const BigNumber = require("bignumber.js");
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
  throw Error("BigNumber .valueOf called!");
};

class TradeDefinition {
  constructor(trade_definition) {
    let {
      pair,
      base_amount_to_buy,
      max_quote_amount_to_buy,
      buy_price,
      stop_price,
      target_price,
      nonBnbFees,
      soft_entry,
      auto_size
    } = trade_definition;

    assert(pair);

    var stringToBool = myValue => myValue === "true" || myValue === true;
    auto_size = stringToBool(auto_size);
    soft_entry = stringToBool(soft_entry);

    if (buy_price === "") {
      buy_price = "0";
    }

    // this.base_amount_held = BigNumber(base_amount_held); // this is in trade_state now
    this.pair = pair;
    this.base_amount_to_buy = BigNumber(base_amount_to_buy); // may not be supported / implemented / tested
    this.max_quote_amount_to_buy = BigNumber(max_quote_amount_to_buy);
    this.buy_price = BigNumber(buy_price);
    this.stop_price = BigNumber(stop_price);
    this.target_price = BigNumber(target_price);
    this.nonBnbFees = nonBnbFees;
    this.soft_entry = soft_entry;
    this.auto_size = auto_size;

    if (this.buy_price.isZero()) {
      throw new Error(`buy_price of 0 as request for a market buy is depricated. Execute your market buy prior to the trade and pass base_amount_held instead`)
  }
}

module.exports = TradeDefinition;
