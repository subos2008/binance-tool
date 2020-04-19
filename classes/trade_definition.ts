const assert = require("assert");
const utils = require('../lib/utils')

import BigNumber from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

class MungedPrices {
  buy_price: BigNumber | null
  stop_price: BigNumber | null
  target_price: BigNumber | null

  constructor(exchange_info: Object, trade_definition: TradeDefinition) {
    assert(exchange_info)
    if (trade_definition.unmunged.buy_price) this.buy_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.buy_price })
    if (trade_definition.unmunged.stop_price) this.stop_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.stop_price })
    if (trade_definition.unmunged.target_price) this.target_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.target_price })
  }
}

export class TradeDefinition {
  pair: string
  base_amount_imported: BigNumber | null
  max_quote_amount_to_buy: BigNumber | null
  soft_entry: Boolean
  auto_size: Boolean
  munged: MungedPrices | null
  unmunged: { buy_price: BigNumber | null, stop_price: BigNumber | null, target_price: BigNumber | null }

  set_exchange_info(exchange_info:any){
    this.munged = new MungedPrices(exchange_info, this)
  }

  constructor(
    trade_definition: {
      pair: string,
      base_amount_imported: BigNumber | string | null,
      max_quote_amount_to_buy: BigNumber | string | null,
      buy_price: BigNumber | string | null,
      stop_price: BigNumber | string | null,
      target_price: BigNumber | string | null,
      soft_entry: Boolean,
      auto_size: Boolean
    },
    exchange_info: any, // guess it'll have to be allowed to be null
  ) {

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
    pair = pair.toUpperCase();

    var stringToBool = (myValue: String | Boolean) => myValue === "true" || myValue === true;
    auto_size = stringToBool(auto_size);
    soft_entry = stringToBool(soft_entry);

    if (base_amount_imported) {
      console.log(`Oooh, trade_definition with base_amount_imported (${base_amount_imported})`)
      this.base_amount_imported = new BigNumber(base_amount_imported);
    }
    this.pair = pair;
    if (max_quote_amount_to_buy)
      this.max_quote_amount_to_buy = new BigNumber(max_quote_amount_to_buy);
    if (buy_price) this.unmunged.buy_price = new BigNumber(buy_price);
    if (stop_price) this.unmunged.stop_price = new BigNumber(stop_price);
    if (target_price) this.unmunged.target_price = new BigNumber(target_price);
    this.soft_entry = soft_entry && true;
    this.auto_size = auto_size && true;

    if (this.unmunged.buy_price && this.unmunged.buy_price.isZero()) {
      throw new Error(
        `buy_price of 0 as request for a market buy is depricated. Execute your market buy prior to the trade and pass base_amount_imported instead`
      );
    }

    this.set_exchange_info(exchange_info)
  }
}
