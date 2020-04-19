const assert = require("assert");

import BigNumber from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class TradeDefinition {
  pair: string
  buy_price: BigNumber | null
  stop_price: BigNumber | null
  target_price: BigNumber | null
  base_amount_imported: BigNumber | null
  max_quote_amount_to_buy: BigNumber | null
  soft_entry: Boolean
  auto_size: Boolean


  constructor(trade_definition: {
    pair: String,
    base_amount_imported: BigNumber,
    max_quote_amount_to_buy: BigNumber,
    buy_price: BigNumber,
    stop_price: BigNumber,
    target_price: BigNumber,
    soft_entry: Boolean,
    auto_size: Boolean
  }) {
    let {
      pair,
      // base_amount_to_buy, // pretty much depricated
      base_amount_imported,
      max_quote_amount_to_buy,
      buy_price,
      stop_price,
      target_price,
      soft_entry,
      auto_size
    } = trade_definition;

    assert(pair);

    var stringToBool = (myValue: String | Boolean) => myValue === "true" || myValue === true;
    auto_size = stringToBool(auto_size);
    soft_entry = stringToBool(soft_entry);

    if (base_amount_imported) {
      console.log(`Oooh, trade_definition with base_amount_imported (${base_amount_imported})`)
      this.base_amount_imported = BigNumber(base_amount_imported);
    }
    this.pair = pair;
    if (max_quote_amount_to_buy)
      this.max_quote_amount_to_buy = BigNumber(max_quote_amount_to_buy);
    if (buy_price) this.buy_price = BigNumber(buy_price);
    if (stop_price) this.stop_price = BigNumber(stop_price);
    if (target_price) this.target_price = BigNumber(target_price);
    this.soft_entry = soft_entry;
    this.auto_size = auto_size;

    if (this.buy_price && this.buy_price.isZero()) {
      throw new Error(
        `buy_price of 0 as request for a market buy is depricated. Execute your market buy prior to the trade and pass base_amount_imported instead`
      );
    }
  }
}
