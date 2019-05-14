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
	constructor({ logger, ee, quote_amount, innerPair, outerPair, algo_utils } = {}) {
		assert(logger);
		this.logger = logger;
		assert(ee);
		this.ee = ee;
		this.ew = new ExchangeWrapper({ ee, algo_utils, logger });
		assert(innerPair);
		this.innerPair = innerPair;
		assert(outerPair);
		this.outerPair = outerPair;
		assert(quote_amount);
		assert(BigNumber.isBigNumber(quote_amount));
		this.quote_amount = quote_amount; // max we can spend
		this.logger.info(`${this.quote_amount} to spend`);
		this.intermediate_amount = BigNumber(0);
		this.base_amount = BigNumber(0);
		assert(algo_utils);
		this.algo_utils = algo_utils;
	}

	async in_buy_zone({ inner_pair_current_price, outer_pair_current_price }) {
		console.log(
			`in vtm in_buy_zone: im(${this.intermediate_amount}) quote(${this.quote_amount}) ooId(${this
				.outerOrderId}) ioId(${this.innerOrderId})`
		);
		if (this.intermediate_amount.isGreaterThan(0)) {
			// we have some money to spend, first let's try and spend any intermediate we have available
			if (!this.innerOrderId) {
				try {
					this.logger.info(`Creating inner buy order`);
					// returns undef on fails of exchange filters
					this.innerOrderId = await this.ew.create_immediate_buy_order({
						pair: this.innerPair,
						limit_price: inner_pair_current_price,
						quote_amount: this.intermediate_amount
					});
				} catch (error) {
					// TODO: at least check for rate limits
					console.log(`Error creating buy order on inner: ${error}`);
					async_error_handler(console, ` error: ${error.body}`, error);
				}
			}
		}
		// and let's also load up on any extra quote we can convert to intermediate
		if (this.quote_amount.isGreaterThan(0)) {
			if (!this.outerOrderId) {
				try {
					this.logger.info(`Creating outer buy order for ${this.quote_amount} quote`);
					// returns undef on fails of exchange filters
					this.outerOrderId = await this.ew.create_immediate_buy_order({
						pair: this.outerPair,
						limit_price: outer_pair_current_price,
						quote_amount: this.quote_amount
					});
				} catch (error) {
					// this can fail for many reasons, not least that we failed the exchange order filters
					// TODO: at least check for rate limits
					console.log(`Error creating buy order on outer`);
					console.log(error);
					async_error_handler(console, ` error: ${error.body}`, error);
				}
			}
		}
	}

	async stop_price_hit() {}

	async target_price_hit() {}

	async start() {
		let obj = this;
		function checkOrderFilled(data, orderFilled) {
			const { symbol, price, quantity, side, orderType, orderId, orderStatus } = data;

			obj.logger.info(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`);
			obj.logger.info(`..price: ${price}, quantity: ${quantity}`);

			if (orderStatus === 'NEW') {
				return;
			}

			if (orderStatus === 'PARTIALLY_FILLED') {
				obj.logger.info(data);
				return;
			}

			if (orderStatus !== 'FILLED') {
				throw new Error(`Order ${orderStatus}. Reason: ${data.r}`);
			}

			obj.logger.info(data);

			//orderFilled(data);
		}

		this.closeUserWebsocket = await this.ee.ws.user((data) => {
			const { orderId, eventType } = data;
			if (eventType !== 'executionReport') {
				return;
			}
			// obj.logger.info(`.ws.user recieved:`);
			// obj.logger.info(data);

			if (orderId === obj.buyOrderId) {
				checkOrderFilled(data, () => {
					obj.buyOrderId = 0;
					this.send_message(`${data.symbol} buy order filled`);
					obj.placeSellOrder();
				});
			} else if (orderId === obj.stopOrderId) {
				checkOrderFilled(data, () => {
					this.send_message(`${data.symbol} stop loss order filled`);
					obj.execution_complete(`Stop hit`, 1);
				});
			} else if (orderId === obj.targetOrderId) {
				checkOrderFilled(data, () => {
					this.send_message(`${data.symbol} target sell order filled`);
					obj.execution_complete(`Target hit`);
				});
			}
		});
	}
}

module.exports = VirtTradeManager;
