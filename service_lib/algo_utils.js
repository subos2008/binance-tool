const utils = require('../lib/utils');
const assert = require('assert');
const BigNumber = require('bignumber.js');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class AlgoUtils {
	constructor({ logger, ee } = {}) {
		assert(logger);
		this.logger = logger;
		assert(ee);
		this.ee = ee;
	}

	set_exchange_info(exchange_info) {
		assert(exchange_info);
		this.exchange_info = exchange_info;
	}

	_munge_amount_and_check_notionals({ pair, amount, buyPrice, stopPrice, targetPrice, limitPrice } = {}) {
		assert(this.exchange_info);
		if (typeof amount !== 'undefined') {
			amount = utils.munge_and_check_quantity({
				exchange_info: this.exchange_info,
				symbol: pair,
				volume: amount
			});

			if (typeof buyPrice !== 'undefined') {
				utils.check_notional({
					price: buyPrice,
					volume: amount,
					exchange_info: this.exchange_info,
					symbol: pair
				});
			}
			if (typeof stopPrice !== 'undefined') {
				utils.check_notional({
					price: stopPrice,
					volume: amount,
					exchange_info: this.exchange_info,
					symbol: pair
				});
			}
			if (typeof targetPrice !== 'undefined') {
				utils.check_notional({
					price: targetPrice,
					volume: amount,
					exchange_info: this.exchange_info,
					symbol: pair
				});
			}
			if (typeof limitPrice !== 'undefined') {
				utils.check_notional({
					price: limitPrice,
					volume: amount,
					exchange_info: this.exchange_info,
					symbol: pair
				});
			}
		}
	}

	split_pair(pair) {
		const [ total, base_currency, quote_currency ] = utils.break_up_binance_pair(pair);
		return {
			quote_currency,
			base_currency
		};
	}

	calculate_percentages({ buyPrice, stopPrice, targetPrice, trading_rules } = {}) {
		let stop_percentage, target_percentage, max_portfolio_percentage_allowed_in_this_trade;
		if (buyPrice && stopPrice) {
			stop_percentage = BigNumber(buyPrice).minus(stopPrice).dividedBy(buyPrice).times(100);
			this.logger.info(`Stop percentage: ${stop_percentage.toFixed(2)}%`);
		}
		if (buyPrice && targetPrice) {
			target_percentage = BigNumber(targetPrice).minus(buyPrice).dividedBy(buyPrice).times(100);
			this.logger.info(`Target percentage: ${target_percentage.toFixed(2)}%`);
		}
		if (stop_percentage && target_percentage) {
			let risk_reward_ratio = target_percentage.dividedBy(stop_percentage);
			this.logger.info(`Risk/reward ratio: ${risk_reward_ratio.toFixed(1)}`);
		}
		if (stop_percentage && trading_rules && trading_rules.max_allowed_portfolio_loss_percentage_per_trade) {
			max_portfolio_percentage_allowed_in_this_trade = BigNumber(
				trading_rules.max_allowed_portfolio_loss_percentage_per_trade
			)
				.dividedBy(stop_percentage)
				.times(100);
			this.logger.info(
				`Max portfolio % allowed in trade: ${max_portfolio_percentage_allowed_in_this_trade.toFixed(1)}%`
			);
		}
		return max_portfolio_percentage_allowed_in_this_trade;
	}

	async create_market_buy_order_by_quote_amount({ pair, quote_amount } = {}) {}

	async create_market_buy_order_by_base_amount({ pair, base_amount } = {}) {
		assert(pair);
		assert(base_amount);
		assert(BigNumber.isBigNumber(base_amount));
		try {
			let args = {
				useServerTime: true,
				side: 'BUY',
				symbol: pair,
				type: 'MARKET',
				quantity: base_amount.toFixed()
			};
			this.logger.info(`Creating MARKET BUY ORDER`);
			this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Market buy error: ${error.body}`, error);
		}
	}

	// TODO: this is slowly hacking it's way up to returning the equivalent of the
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
		{ max_portfolio_percentage_allowed_in_this_trade, quote_currency } = {}
	) {
		assert(max_portfolio_percentage_allowed_in_this_trade);
		assert(BigNumber.isBigNumber(max_portfolio_percentage_allowed_in_this_trade));
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
			.times(max_portfolio_percentage_allowed_in_this_trade)
			.dividedBy(100);
		this.logger.info(`Max allowed to invest: ${max_quote_amount_to_invest} ${quote_currency}`);
		this.logger.info(`Available to invest: ${quote_portfolio.available} ${quote_currency}`);
		return BigNumber.minimum(max_quote_amount_to_invest, quote_portfolio.available);
	}
}

module.exports = AlgoUtils;
