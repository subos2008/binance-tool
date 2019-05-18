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

	munge_and_check_price({ symbol, price } = {}) {
		return utils.munge_and_check_price({ exchange_info: this.exchange_info, symbol, price });
	}

	munge_amount_and_check_notionals({ pair, amount, buyPrice, stopPrice, targetPrice, limitPrice } = {}) {
		assert(this.exchange_info);
		assert(pair);
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
			return amount;
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

	// async create_market_buy_order_by_quote_amount({ pair, quote_amount } = {}) {}

	// async create_market_buy_order_by_base_amount({ pair, base_amount } = {}) {
	// 	assert(pair);
	// 	assert(base_amount);
	// 	assert(BigNumber.isBigNumber(base_amount));
	// 	try {
	// 		let args = {
	// 			useServerTime: true,
	// 			side: 'BUY',
	// 			symbol: pair,
	// 			type: 'MARKET',
	// 			quantity: base_amount.toFixed()
	// 		};
	// 		this.logger.info(`Creating MARKET BUY ORDER`);
	// 		this.logger.info(args);
	// 		let response = await this.ee.order(args);
	// 		this.logger.info(`order id: ${response.orderId}`);
	// 		return response.orderId;
	// 	} catch (error) {
	// 		async_error_handler(console, `Market buy error: ${error.body}`, error);
	// 	}
	// }

	async _create_limit_buy_order({ pair, base_amount, limit_price } = {}) {
		try {
			let args = {
				useServerTime: true,
				side: 'BUY',
				symbol: this.pair,
				type: 'LIMIT',
				quantity: this.amount.toFixed(),
				price: this.buyPrice.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			this.logger.info(`Creating LIMIT BUY ORDER`);
			this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info('LIMIT BUY response', response);
			this.logger.info(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	}
}

module.exports = AlgoUtils;
