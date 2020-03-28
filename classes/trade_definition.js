const assert = require("assert");

// pair,
// max_quote_amount_to_buy,
// buy_price,
// stop_price,
// limit_price,
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

class TradeDefinition {
  constructor(trade_definition) {
    let {
      pair,
      base_amount_to_buy,
      max_quote_amount_to_buy,
      buy_price,
      stop_price,
      sell_stop_limit_price: limit_price,
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

    //     this.sell_stop_limit_price: limit_price,

    this.pair = pair;
    this.base_amount_to_buy = base_amount_to_buy; // may not be supported / implemented / tested
    // this.base_amount_held = base_amount_held; // this is in trade_state now
    this.max_quote_amount_to_buy = max_quote_amount_to_buy;
    this.buy_price = buy_price;
    this.stop_price = stop_price;
    this.target_price = target_price;
    this.nonBnbFees = nonBnbFees;
    this.soft_entry = soft_entry;
    this.auto_size = auto_size;
  }
}

module.exports = TradeDefinition;
