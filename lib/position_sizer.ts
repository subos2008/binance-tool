const utils = require('../lib/utils');
import { strict as assert } from 'assert';;

import BigNumber from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error('BigNumber .valueOf called!');
};

import { Logger } from "../interfaces/logger";
import { TradingRules } from "./trading_rules";

import * as Sentry from '@sentry/node';

export class PositionSizer {
  logger: Logger
  ee: any
  trading_rules: TradingRules

  constructor({ logger, ee, trading_rules }: { logger: Logger, ee: any, trading_rules: TradingRules }) {
    assert(logger);
    this.logger = logger;
    assert(ee);
    this.ee = ee;
    assert.ok(trading_rules, 'missing trading_rules');
    this.trading_rules = trading_rules;
  }

  // TODO: this method is working it's way up to returning the liquidated value of the
  // TODO: total portfolio in whatever quote currency is supplied
  async _get_portfolio_value_from_exchange({ quote_currency }: { quote_currency: string })
    : Promise<{ available: BigNumber, total: BigNumber }> {
    assert(quote_currency);
    let balances
    let prices: { [name: string]: string };
    try {
      let response = await this.ee.accountInfo();
      balances = response.balances;
    } catch (err) {
      Sentry.captureException(err);
      this.logger.error(`Getting account info from exchange:`)
      this.logger.error(err)
      throw error
    }
    try {
      prices = await this.ee.prices();
    } catch (err) {
      Sentry.captureException(err);
      this.logger.error(`Getting account info from exchange:`)
      this.logger.error(err)
      throw error
    }

    // try {
    let available = new BigNumber(0), // only reflects quote_currency
      total = new BigNumber(0); // running total of all calculable asset values converted to quote_currency
    let count = 0;
    balances.forEach((balance: any) => {
      if (balance.asset === quote_currency) {
        available = available.plus(balance.free);
        total = total.plus(balance.free).plus(balance.locked);
      } else {
        // convert coin value to quote_currency if possible, else skip it
        let pair = `${balance.asset}${quote_currency}`;
        try {
          if (pair in prices) {
            let amount_held = new BigNumber(balance.free).plus(balance.locked);
            let value = amount_held.times(prices[pair]);
            total = total.plus(value);
          } else {
            // this.logger.warn(
            // 	`Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
            // );
            count += 1;
          }
        } catch (e) {
          this.logger.warn(
            `Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
          );
        }
      }
    });
    this.logger.warn(`Non fatal error: unable to convert ${count} assets to ${quote_currency}, skipping`);
    return { available, total };
    // } catch (err) {
    //   async_error_handler(console, `calculating portfolio value`, error);
    // }
  }

  async _calculate_autosized_quote_volume_available(
    { max_portfolio_percentage_allowed_in_trade, quote_currency }:
      { max_portfolio_percentage_allowed_in_trade: BigNumber, quote_currency: string }
  ) {
    assert(max_portfolio_percentage_allowed_in_trade);
    assert(BigNumber.isBigNumber(max_portfolio_percentage_allowed_in_trade));
    assert(quote_currency);
    let quote_portfolio;
    // try {
    quote_portfolio = await this._get_portfolio_value_from_exchange({
      quote_currency: quote_currency
    });
    // } catch (err) {
    //   async_error_handler(console, `Autosizing error during portfolio sizing: ${error.body}`, error);
    // }
    assert(BigNumber.isBigNumber(quote_portfolio.total));
    assert(BigNumber.isBigNumber(quote_portfolio.available));
    let max_quote_amount_to_invest = quote_portfolio.total
      .times(max_portfolio_percentage_allowed_in_trade)
      .dividedBy(100);
    this.logger.info(
      `Max allowed to invest, based on stop percentage: ${max_quote_amount_to_invest.toFixed()} ${quote_currency}`
    );
    this.logger.info(`Available to invest: ${quote_portfolio.available.toFixed()} ${quote_currency}`);
    return BigNumber.minimum(max_quote_amount_to_invest, quote_portfolio.available);
  }

  max_portfolio_percentage_allowed_in_trade({ buy_price, stop_price }: { buy_price: BigNumber, stop_price: BigNumber }) {
    assert(this.trading_rules);
    assert(buy_price);
    assert(stop_price);
    let stop_percentage = new BigNumber(buy_price).minus(stop_price).dividedBy(buy_price).times(100);
    return new BigNumber(this.trading_rules.max_allowed_portfolio_loss_percentage_per_trade)
      .dividedBy(stop_percentage)
      .times(100);
  }

  async size_position(
    { buy_price, stop_price, quote_currency, max_quote_amount_to_buy, do_not_auto_size_for_stop_percentage }
      : { buy_price: BigNumber, stop_price: BigNumber, quote_currency: string, max_quote_amount_to_buy?: BigNumber, do_not_auto_size_for_stop_percentage?: boolean }
  ): Promise<{ quote_volume: BigNumber, base_amount: BigNumber }> {
    assert(quote_currency);
    assert(buy_price);
    if (!this.trading_rules.allowed_to_trade_without_stop) {
      //TODO: have a specific error class for TradingRules violations
      if (!stop_price) throw new Error(`TRADING_RULES_VIOLATION: attempt to trade without stop price`);
    }

    let max_portfolio_percentage_allowed_in_trade;
    if (do_not_auto_size_for_stop_percentage || !stop_price) {
      max_portfolio_percentage_allowed_in_trade = new BigNumber(100);
    } else {
      max_portfolio_percentage_allowed_in_trade = this.max_portfolio_percentage_allowed_in_trade({
        buy_price,
        stop_price
      });
    }
    if (this.trading_rules.max_portfolio_percentage_per_trade) {
      max_portfolio_percentage_allowed_in_trade = BigNumber.minimum(max_portfolio_percentage_allowed_in_trade, this.trading_rules.max_portfolio_percentage_per_trade)
      this.logger.info(`Applied trading_rules.max_portfolio_percentage_per_trade, now: ${max_portfolio_percentage_allowed_in_trade.toFixed()}%`)
    }

    let quote_volume = await this._calculate_autosized_quote_volume_available({
      max_portfolio_percentage_allowed_in_trade,
      quote_currency
    });
    if (max_quote_amount_to_buy) {
      quote_volume = BigNumber.minimum(quote_volume, max_quote_amount_to_buy);
    }
    assert(quote_volume.isFinite());
    let base_amount = utils.quote_volume_at_price_to_base_volume({
      quote_volume,
      price: buy_price
    });
    assert(base_amount);
    return { quote_volume, base_amount };
  }
}
