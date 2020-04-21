const assert = require("assert");
const utils = require('../lib/utils')

import BigNumber from "bignumber.js";
import { TradingRules } from "../lib/trading_rules";
import { Logger } from "../interfaces/logger";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

class MungedPrices {
  buy_price: BigNumber | undefined
  stop_price: BigNumber | undefined
  target_price: BigNumber | undefined

  constructor(exchange_info: Object, trade_definition: TradeDefinition) {
    assert(exchange_info)
    if (trade_definition.unmunged.buy_price) this.buy_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.buy_price })
    if (trade_definition.unmunged.stop_price) this.stop_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.stop_price })
    if (trade_definition.unmunged.target_price) this.target_price = utils.munge_and_check_price({ exchange_info, symbol: trade_definition.pair, price: trade_definition.unmunged.target_price })
  }
}

export class TradeDefinition {
  logger: Logger
  pair: string
  base_amount_imported: BigNumber | null
  max_quote_amount_to_buy: BigNumber | null
  soft_entry: Boolean
  auto_size: Boolean
  munged: MungedPrices
  unmunged: { buy_price: BigNumber | null, stop_price: BigNumber | null, target_price: BigNumber | null }

  set_exchange_info(exchange_info: any) {
    this.munged = new MungedPrices(exchange_info, this)
  }

  constructor(logger: Logger,
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
    assert(logger);
    this.logger = logger

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

    // Sanity checks
    if (this.unmunged.buy_price) assert(!this.unmunged.buy_price.isZero()); // depricated way of specifying a market buy

    // TODO: we can add a few more - for example to swap between stop and terget orders based on the
    // percentage of anb price to those levels - what if these price ranges where we prep for each order type overlap?
    if (this.unmunged.buy_price && this.unmunged.stop_price) assert(this.unmunged.stop_price.isLessThan(this.unmunged.buy_price));
    if (this.unmunged.target_price && this.unmunged.buy_price)
      assert(this.unmunged.target_price.isGreaterThan(this.unmunged.buy_price));
    if (this.unmunged.target_price && this.unmunged.stop_price)
      assert(this.unmunged.target_price.isGreaterThan(this.unmunged.stop_price));

    if (this.soft_entry) assert(this.unmunged.buy_price);

    this.set_exchange_info(exchange_info)
  }


  print_trade_for_user(trading_rules?: TradingRules) {
    try {
      let { buy_price, stop_price, target_price } = this.munged;
      if (trading_rules) {
        this.logger.info(
          `Max portfolio loss per trade: ${trading_rules.max_allowed_portfolio_loss_percentage_per_trade}%`
        );
      }
      this.calculate_percentages({
        buy_price,
        stop_price,
        target_price,
        trading_rules
      });
    } catch (error) {
      this.logger.warn(error); // eat the error, this is non-essential
    }
  }

  get_message():string{
    let buy_msg = this.munged.buy_price ? `buy: ${this.munged.buy_price}` : "";
    let stop_msg = this.munged.stop_price ? `stop: ${this.munged.stop_price}` : "";
    let target_msg = this.munged.target_price ? `target: ${this.munged.target_price}` : "";
    return `${this.pair}: from ${buy_msg} to ${stop_msg} or ${target_msg}`
  }

  calculate_percentages({ buy_price, stop_price, target_price, trading_rules }
    : { buy_price?: BigNumber, stop_price?: BigNumber, target_price?: BigNumber, trading_rules?: TradingRules }) {
    let stop_percentage, target_percentage, max_portfolio_percentage_allowed_in_this_trade;
    if (buy_price && stop_price) {
      assert(buy_price.isGreaterThan(0));
      stop_percentage = new BigNumber(buy_price).minus(stop_price).dividedBy(buy_price).times(100);
      assert(stop_percentage.isFinite());
      this.logger.info(`Stop percentage: ${stop_percentage.toFixed(2)}%`);
    }
    if (buy_price && target_price) {
      target_percentage = new BigNumber(target_price).minus(buy_price).dividedBy(buy_price).times(100);
      this.logger.info(`Target percentage: ${target_percentage.toFixed(2)}%`);
    }
    if (stop_percentage && target_percentage) {
      let risk_reward_ratio = target_percentage.dividedBy(stop_percentage);
      this.logger.info(`Risk/reward ratio: ${risk_reward_ratio.toFixed(1)}`);
    }
    if (stop_percentage && trading_rules && trading_rules.max_allowed_portfolio_loss_percentage_per_trade) {
      max_portfolio_percentage_allowed_in_this_trade = new BigNumber(
        trading_rules.max_allowed_portfolio_loss_percentage_per_trade
      )
        .dividedBy(stop_percentage)
        .times(100);
      this.logger.info(
        `Max portfolio allowed in trade: ${max_portfolio_percentage_allowed_in_this_trade.toFixed(1)}%`
      );
    }
    return max_portfolio_percentage_allowed_in_this_trade;
  }
}
