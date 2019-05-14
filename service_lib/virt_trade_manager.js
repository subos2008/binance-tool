const utils = require('../lib/utils');
const assert = require('assert');
const BigNumber = require('bignumber.js');
const async_error_handler = require('../lib/async_error_handler');
const ExchangeWrapper = require('./exchange_wrapper');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class VirtTradeManager {
	constructor({ logger, ee, quote_amount, innerPair, outerPair, algo_utils, slippage_percent } = {}) {
		assert(logger);
		this.logger = logger;
		assert(ee);
		this.ee = ee;
		this.ew = new ExchangeWrapper({ ee, algo_utils, logger });
		this.pairs = {};
		assert(innerPair);
		this.pairs.inner = innerPair;
		assert(outerPair);
		this.pairs.outer = outerPair;
		assert(quote_amount);
		assert(BigNumber.isBigNumber(quote_amount));
		this.quote_amount = quote_amount; // max we can spend
		this.logger.info(`${this.quote_amount} to spend`);
		this.intermediate_amount = BigNumber(0);
		this.base_amount = BigNumber(0);
		assert(algo_utils);
		this.algo_utils = algo_utils;
		this.buys_in_progress = {};
		assert(slippage_percent);
		assert(BigNumber.isBigNumber(slippage_percent));
		this.slippage_percent = slippage_percent; // percent i.e. 1
	}

	async attempt_buy({ name, current_price, quote_amount } = {}) {
		assert(name);
		let slippage_factor = this.slippage_percent.div(100).plus(1);
		current_price = current_price.times(slippage_factor);
		if (!this.ew.is_tradeable_quote_amount({ pair: this.pairs[name], limit_price: current_price, quote_amount })) {
			console.log(`${name} too small to trade`);
			return false;
		}
		if (this.buys_in_progress[name]) {
			console.log(`${name} buy already in progress`);
			return false;
		}

		try {
			this.logger.info(`Creating ${name} buy order`);
			// returns undef on fails of exchange filters
			this.buys_in_progress[name] = true;
			let response = await this.ew.create_immediate_buy_order({
				pair: this.pairs[name],
				limit_price: current_price,
				quote_amount
			});
			assert('cummulativeQuoteQty' in response);
			assert('executedQty' in response);
			this.buys_in_progress[name] = false;
			return response;
		} catch (error) {
			// TODO: at least check for rate limits
			console.log(`Error creating buy order on inner: ${error}`);
			async_error_handler(console, ` error: ${error.body}`, error);
		}
	}

	// TODO: how would it respond if I sell some coin it thinks it is managing?
	// there's no orders to cancel if this thing goes batshit
	// there's no rate limiting
	// doens't close on exit or soft_exit

	// return true if it can't afford to buy any more
	async in_buy_zone({ inner_pair_current_price, outer_pair_current_price }) {
		console.log(
			`in_buy_zone: base(${this.base_amount}) im(${this.intermediate_amount}) quote(${this
				.quote_amount}) buys: [${Object.keys(this.buys_in_progress).join(', ')}]`
		);

		let inner_is_a_tradeable_amount = this.ew.is_tradeable_quote_amount({
			pair: this.pairs['inner'],
			limit_price: inner_pair_current_price,
			quote_amount: this.intermediate_amount
		});

		let outer_is_a_tradeable_amount = this.ew.is_tradeable_quote_amount({
			pair: this.pairs['outer'],
			limit_price: outer_pair_current_price,
			quote_amount: this.quote_amount
		});

		if (!inner_is_a_tradeable_amount && !outer_is_a_tradeable_amount) {
			return true; // buy filled
		}

		if (inner_is_a_tradeable_amount) {
			try {
				// we have some money to spend, first let's try and spend any intermediate we have available
				let response = await this.attempt_buy({
					current_price: inner_pair_current_price,
					name: 'inner',
					quote_amount: this.intermediate_amount
				});
				if (response !== false) {
					this.intermediate_amount = this.intermediate_amount.minus(response.cummulativeQuoteQty);
					this.base_amount = this.base_amount.plus(response.executedQty);
				}
			} catch (error) {
				async_error_handler(this.logger, ` error: ${error.body}`, error);
			}
		}
		// and let's also load up on any extra quote we can convert to intermediate
		if (outer_is_a_tradeable_amount) {
			try {
				// we have some money to spend, first let's try and spend any intermediate we have available
				let response = await this.attempt_buy({
					current_price: outer_pair_current_price,
					name: 'outer',
					quote_amount: this.quote_amount
				});
				if (response !== false) {
					this.quote_amount = this.quote_amount.minus(response.cummulativeQuoteQty);
					this.intermediate_amount = this.intermediate_amount.plus(response.executedQty);
				}
			} catch (error) {
				async_error_handler(this.logger, ` error: ${error.body}`, error);
			}
		}
		return false;
	}

	async stop_price_hit() {}

	async target_price_hit() {}

	async start() {}
}

module.exports = VirtTradeManager;
