const utils = require('../lib/utils');
const assert = require('assert');

class AlgoUtils {
	constructor({ exchange_info } = {}) {
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
}

module.exports = AlgoUtils;
