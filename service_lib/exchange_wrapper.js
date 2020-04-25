const utils = require('../lib/utils');
import { strict as assert } from 'assert';;
const BigNumber = require('bignumber.js');
const async_error_handler = require('../lib/async_error_handler');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class ExchangeWrapper {
	constructor({ ee, algo_utils, logger } = {}) {
		assert(ee);
		this.ee = ee;
		assert(algo_utils);
		this.algo_utils = algo_utils;
		assert(logger);
		this.logger = logger;
	}

	is_tradeable_quote_amount({ pair, limit_price, quote_amount } = {}) {
		try {
			limit_price = this.algo_utils.munge_and_check_price({ price: limit_price, symbol: pair });
			let base_amount = utils.quote_volume_at_price_to_base_volume({
				quote_volume: quote_amount,
				price: limit_price
			});
			base_amount = this.algo_utils.munge_amount_and_check_notionals({
				pair,
				amount: base_amount,
				buy_price: limit_price
			});
			return true;
		} catch (e) {
			if (e.toString().includes('MIN_NOTIONAL')) return false;
			if (e.toString().includes('LOT_SIZE')) return false;
			throw e;
		}
	}

	// trys and returns undefined on any issues
	async create_immediate_buy_order({ pair, limit_price, quote_amount } = {}) {
		assert(quote_amount);
		assert(BigNumber.isBigNumber(quote_amount));
		let base_amount;
		try {
			limit_price = this.algo_utils.munge_and_check_price({ price: limit_price, symbol: pair });
			base_amount = utils.quote_volume_at_price_to_base_volume({
				quote_volume: quote_amount,
				price: limit_price
			});
			base_amount = this.algo_utils.munge_amount_and_check_notionals({
				pair,
				amount: base_amount,
				buy_price: limit_price
			});
		} catch (e) {
			console.log(e);
			throw e;
		}
		try {
			let args = {
				useServerTime: true,
				side: 'BUY',
				symbol: pair,
				type: 'LIMIT',
				quantity: base_amount.toFixed(),
				price: limit_price.toFixed(),
				timeInForce: 'IOC',
				newOrderRespType: 'FULL'
			};
			this.logger.info(`Creating LIMIT BUY ORDER`);
			this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info('LIMIT BUY response:');
			this.logger.info(response);
			this.logger.info(`order id: ${response.orderId}`);
			return response;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	}
}

module.exports = ExchangeWrapper;
