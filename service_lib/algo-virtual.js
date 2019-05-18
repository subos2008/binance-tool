const async_error_handler = require('../lib/async_error_handler');
const { ExitNow } = require('../lib/errors');
const StateMachine = require('javascript-state-machine');
const BigNumber = require('bignumber.js');
const utils = require('../lib/utils');
const AlgoUtils = require('./algo_utils');
const VirtualTradeManager = require('./virt_trade_manager');
const assert = require('assert');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class Algo {
	// All numbers are expected to be passed in as strings
	constructor(
		{
			ee, // binance-api-node API
			send_message,
			logger,
			quoteAmount,
			buy_price,
			stop_price,
			limit_price,
			target_price,
			nonBnbFees,
			trading_rules,
			auto_size,
			percentages,
			virtualPair,
			intermediateCurrency,
			slippage_percent
		} = {}
	) {
		assert(logger);
		assert(send_message);
		assert(virtualPair);

		this.ee = ee;
		this.send_message = send_message;
		assert(quoteAmount);
		this.quoteAmount = BigNumber(quoteAmount);
		this.buy_price = buy_price;
		this.stop_price = stop_price;
		this.limit_price = limit_price;
		this.target_price = target_price;
		this.nonBnbFees = nonBnbFees;
		this.logger = logger;
		this.trading_rules = trading_rules;
		this.auto_size = auto_size;
		this.percentages = percentages;
		this.virtualPair = virtualPair;
		this.intermediateCurrency = intermediateCurrency;

		assert(!this.auto_size); // not implemented
		assert(!this.limit_price); // not implemented
		assert(!this.nonBnbFees); // not implemented

		assert(typeof this.logger === 'object', `typeof this.logger: ${typeof this.logger}`);
		this.algo_utils = new AlgoUtils({ logger: this.logger, ee });

		if (typeof this.stop_price !== 'undefined') {
			this.stop_price = BigNumber(this.stop_price);
		}

		if (typeof this.target_price !== 'undefined') {
			this.target_price = BigNumber(this.target_price);
		}

		if (typeof this.buy_price !== 'undefined') {
			this.buy_price = BigNumber(this.buy_price);
			this.waiting_for_soft_entry_price = true;
			assert(!this.buy_price.isZero()); // market buys not implemented
		}

		assert(this.virtualPair);
		assert(this.intermediateCurrency);
		this.virtualPair = this.virtualPair.toUpperCase();
		let { quote_currency, base_currency } = this.algo_utils.split_pair(this.virtualPair);
		this.innerPair = `${base_currency}${this.intermediateCurrency}`;
		this.outerPair = `${this.intermediateCurrency}${quote_currency}`;
		this.quote_currency = quote_currency;

		assert(slippage_percent);
		assert(BigNumber.isBigNumber(slippage_percent));
		this.slippage_percent = slippage_percent; // percent i.e. 1

		this.trade_manager = new VirtualTradeManager({
			logger,
			ee,
			quote_amount: this.quoteAmount,
			innerPair: this.innerPair,
			outerPair: this.outerPair,
			algo_utils: this.algo_utils,
			slippage_percent
		});
	}

	shutdown_streams() {
		if (this.closeUserWebsocket) this.closeUserWebsocket();
		if (this.closeTradesWebSocket) this.closeTradesWebSocket();
	}

	execution_complete(msg, exit_code = 0) {
		this.logger.info(`ExecutionComplete: ${msg}`);
		if (exit_code) process.exitCode = exit_code;
		this.shutdown_streams();
	}

	async main() {
		try {
			this.exchange_info = await this.ee.exchangeInfo();
			this.algo_utils.set_exchange_info(this.exchange_info);
		} catch (error) {
			async_error_handler(this.logger, 'Error could not pull exchange info', error);
		}

		try {
			if (!this.quoteAmount && !this.auto_size) {
				let msg = 'You must specify amount with -q or use --auto-size';
				this.logger.error(msg);
				throw new Error(msg);
			}

			this.algo_utils.calculate_percentages({
				buy_price: this.buy_price,
				stop_price: this.stop_price,
				target_price: this.target_price,
				trading_rules: this.trading_rules
			});
			if (this.percentages) return;

			this.send_message(
				`${this.virtualPair} New trade buy: ${this.buy_price}, stop: ${this.stop_price}, target: ${this
					.target_price}`
			);

			await this.trade_manager.start();
			await this._monitor_trades_virtual();
		} catch (error) {
			async_error_handler(console, `exception in main loop (virtual): ${error.body}`, error);
		}
	}

	async _monitor_trades_virtual() {
		try {
			let obj = this;
			assert(this.innerPair);
			assert(this.outerPair);
			let innerPrice,
				outerPrice,
				currentPrice,
				buy_complete = false;
			this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.innerPair, this.outerPair ], async function(
				trade
			) {
				var { symbol, price: symbol_price } = trade;
				assert(symbol);
				assert(symbol_price);
				symbol_price = BigNumber(symbol_price);

				if (symbol === obj.outerPair) {
					outerPrice = symbol_price;
				} else if (symbol === obj.innerPair) {
					innerPrice = symbol_price;
				} else {
					console.error(`Unexpected pair in trades stream ${pair}`);
				}

				if (typeof innerPrice === 'undefined' || typeof outerPrice === 'undefined') {
					return;
				}

				currentPrice = innerPrice.times(outerPrice);
				obj.logger.info(`Virtual pair price: ${currentPrice.toFixed()}`);

				// TODO: finish implementing
				if (typeof obj.stop_price !== 'undefined' && currentPrice.isLessThanOrEqualTo(obj.stop_price)) {
					try {
						await obj.trade_manager.stop_price_hit();
					} catch (error) {
						async_error_handler(obj.logger, `Error during limit buy order: ${error.body}`, error);
					}
					return;
				}

				if (
					typeof obj.buy_price !== 'undefined' &&
					!buy_complete &&
					currentPrice.isLessThanOrEqualTo(obj.buy_price)
				) {
					try {
						buy_complete = await obj.trade_manager.in_buy_zone({
							inner_pair_current_price: innerPrice, // TODO: calculate what would exactly match the buy_price
							outer_pair_current_price: outerPrice // this is liquid so use current price
						});
						if (buy_complete) {
							obj.send_message(`${obj.virtualPair} (virt) buy complete`);
							if (!obj.stop_price && !obj.target_price) {
								obj.execution_complete(`exiting buy complete`);
							}
						}
					} catch (error) {
						console.error(error);
						async_error_handler(obj.logger, `Error during limit buy order: ${error.body}`, error);
					}
					return;
				}

				// 	} else if (obj.stopOrderId || obj.targetOrderId) {
				// 		// obj.logger.info(
				// 		// 	`${symbol} trade update. price: ${price} stop: ${obj.stop_price} target: ${obj.target_price}`
				// 		// );
				// 		if (
				// 			obj.stopOrderId &&
				// 			!obj.targetOrderId &&
				// 			price.isGreaterThanOrEqualTo(obj.target_price) &&
				// 			!isCancelling
				// 		) {
				// 			obj.logger.info(`Event: price >= target_price: cancelling stop and placeTargetOrder()`);
				// 			isCancelling = true;
				// 			try {
				// 				await obj.ee.cancelOrder({ symbol, orderId: obj.stopOrderId });
				// 				obj.stopOrderId = 0;
				// 				isCancelling = false;
				// 			} catch (error) {
				// 				console.error(`${symbol} cancel error:`, error.body);
				// 				console.error(error);
				// 				return;
				// 			}
				// 			try {
				// 				obj.targetOrderId = await obj.placeTargetOrder();
				// 				obj.logger.info(`Set targetOrderId: ${obj.targetOrderId}`);
				// 			} catch (error) {
				// 				async_error_handler(console, `error placing order: ${error.body}`, error);
				// 			}
				// 		} else if (
				// 			obj.targetOrderId &&
				// 			!obj.stopOrderId &&
				// 			price.isLessThanOrEqualTo(obj.stop_price) &&
				// 			!isCancelling
				// 		) {
				// 			isCancelling = true;
				// 			try {
				// 				await obj.ee.cancelOrder({ symbol, orderId: obj.targetOrderId });
				// 				isCancelling = false;
				// 			} catch (error) {
				// 				console.error(`${symbol} cancel error:`, error.body);
				// 				return;
				// 			}
				// 			obj.targetOrderId = 0;
				// 			obj.logger.info(`${symbol} cancel response:`, response);
				// 			try {
				// 				obj.stopOrderId = await obj.placeStopOrder();
				// 				obj.logger.info(`Set stopOrderId: ${obj.stopOrderId}`);
				// 			} catch (error) {
				// 				async_error_handler(console, `error placing order: ${error.body}`, error);
				// 			}
				// 		}
				// 	}
			});
		} catch (error) {
			async_error_handler(console, `exception in _monitor_trades: ${error.body}`, error);
		}
	}

	async _virtual_pair_market_buy() {
		try {
			await this._create_market_buy_order;
		} catch (error) {
			async_error_handler(console, `exception in _monitor_trades: ${error.body}`, error);
		}
	}
}

module.exports = Algo;
