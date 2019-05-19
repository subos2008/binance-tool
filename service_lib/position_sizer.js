const utils = require('../lib/utils');
const assert = require('assert');
const async_error_handler = require('../lib/async_error_handler');
const BigNumber = require('bignumber.js');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class PositionSizer {
	constructor({ logger, ee, trading_rules } = {}) {
		assert(logger);
		this.logger = logger;
		assert(ee);
		this.ee = ee;
		assert(trading_rules);
		this.trading_rules = trading_rules;
	}

	// TODO: this is slowly hacking it's way up to returning the liquidated value of the
	// TODO: total portfolio in whatever quote currency is supplied
	async _get_portfolio_value_from_exchange({ quote_currency } = {}) {
		assert(quote_currency);
		let balances, prices;
		try {
			let response = await this.ee.accountInfo();
			balances = response.balances;
		} catch (error) {
			async_error_handler(console, `Getting account info from exchange: ${error.body}`, error);
		}
		try {
			prices = await this.ee.prices();
		} catch (error) {
			async_error_handler(console, `Getting account info from exchange: ${error.body}`, error);
		}

		try {
			let available = BigNumber(0), // only reflects quote_currency
				total = BigNumber(0); // running total of all calculable asset values converted to quote_currency
			balances.forEach((balance) => {
				if (balance.asset === quote_currency) {
					available = available.plus(balance.free);
					total = total.plus(balance.free).plus(balance.locked);
				} else {
					// convert coin value to quote_currency if possible, else skip it
					let pair = `${balance.asset}${quote_currency}`;
					try {
						if (pair in prices) {
							let amount_held = BigNumber(balance.free).plus(balance.locked);
							let value = amount_held.times(prices[pair]);
							total = total.plus(value);
						} else {
							this.logger.warn(
								`Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
							);
						}
					} catch (e) {
						this.logger.warn(
							`Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
						);
					}
				}
			});
			return { available, total };
		} catch (error) {
			async_error_handler(console, `calculating portfolio value`, error);
		}
	}

	async _calculate_autosized_quote_volume_available(
		{ max_portfolio_percentage_allowed_in_trade, quote_currency } = {}
	) {
		assert(max_portfolio_percentage_allowed_in_trade);
		assert(BigNumber.isBigNumber(max_portfolio_percentage_allowed_in_trade));
		assert(quote_currency);
		let quote_portfolio;
		try {
			quote_portfolio = await this._get_portfolio_value_from_exchange({
				quote_currency: quote_currency
			});
		} catch (error) {
			async_error_handler(console, `Autosizing error during portfolio sizing: ${error.body}`, error);
		}
		assert(BigNumber.isBigNumber(quote_portfolio.total));
		assert(BigNumber.isBigNumber(quote_portfolio.available));
		let max_quote_amount_to_invest = quote_portfolio.total
			.times(max_portfolio_percentage_allowed_in_trade)
			.dividedBy(100);
		this.logger.info(
			`Max allowed to invest, based on stop percentage: ${max_quote_amount_to_invest} ${quote_currency}`
		);
		this.logger.info(`Available to invest: ${quote_portfolio.available} ${quote_currency}`);
		return BigNumber.minimum(max_quote_amount_to_invest, quote_portfolio.available);
	}

	max_portfolio_percentage_allowed_in_trade({ buy_price, stop_price } = {}) {
		assert(this.trading_rules);
		assert(buy_price);
		assert(stop_price);
		let stop_percentage = BigNumber(buy_price).minus(stop_price).dividedBy(buy_price).times(100);
		return BigNumber(this.trading_rules.max_allowed_portfolio_loss_percentage_per_trade)
			.dividedBy(stop_percentage)
			.times(100);
	}

	async size_position(
		{ buy_price, stop_price, quote_currency, max_quote_amount_to_buy, do_not_auto_size_for_stop_percentage } = {}
	) {
		assert(quote_currency);
		assert(buy_price);
		if (!this.trading_rules.allowed_to_trade_without_stop) {
			//TODO: have a specific error class for TradingRules violations
			if (!stop_price) throw new Error(`TRADING_RULES_VIOLATION: attempt to trade without stop price`);
		}

		try {
			let max_portfolio_percentage_allowed_in_trade;
			if (do_not_auto_size_for_stop_percentage || !stop_price) {
				max_portfolio_percentage_allowed_in_trade = BigNumber(100);
			} else {
				max_portfolio_percentage_allowed_in_trade = this.max_portfolio_percentage_allowed_in_trade({
					buy_price,
					stop_price
				});
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
			return { quote_volume, base_amount };
		} catch (error) {
			async_error_handler(this.logger, `Error when sizing trade:`, error);
		}
	}
}

module.exports = PositionSizer;
