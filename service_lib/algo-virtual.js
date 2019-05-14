const async_error_handler = require('../lib/async_error_handler');
const { ExitNow } = require('../lib/errors');
const StateMachine = require('javascript-state-machine');
const BigNumber = require('bignumber.js');
const utils = require('../lib/utils');
const AlgoUtils = require('./algo_utils');
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
			amount,
			quoteAmount,
			buyPrice,
			stopPrice,
			limitPrice,
			targetPrice,
			nonBnbFees,
			soft_entry,
			trading_rules,
			auto_size,
			percentages,
			virtualPair,
			intermediateCurrency
		} = {}
	) {
		assert(logger);
		assert(send_message);
		assert(virtualPair);

		this.ee = ee;
		this.send_message = send_message;
		this.amount = amount;
		this.quoteAmount = quoteAmount;
		this.buyPrice = buyPrice;
		this.stopPrice = stopPrice;
		this.limitPrice = limitPrice;
		this.targetPrice = targetPrice;
		this.nonBnbFees = nonBnbFees;
		this.logger = logger;
		this.soft_entry = soft_entry;
		this.trading_rules = trading_rules;
		this.auto_size = auto_size;
		this.percentages = percentages;
		this.virtualPair = virtualPair;
		this.intermediateCurrency = intermediateCurrency;

		assert(typeof this.logger === 'object', `typeof this.logger: ${typeof this.logger}`);
		this.algo_utils = new AlgoUtils({ logger: this.logger, ee });

		assert(this.virtualPair);
		assert(this.intermediateCurrency);
		this.virtualPair = this.virtualPair.toUpperCase();
		let { quote_currency, base_currency } = this.algo_utils.split_pair(this.virtualPair);
		this.innerPair = `${base_currency}${this.intermediateCurrency}`;
		this.outerPair = `${this.intermediateCurrency}${quote_currency}`;
		this.quote_currency = quote_currency;
	}

	calculate_percentages() {
		let stop_percentage, target_percentage;
		if (this.buyPrice && this.stopPrice) {
			stop_percentage = BigNumber(this.buyPrice).minus(this.stopPrice).dividedBy(this.buyPrice).times(100);
			this.logger.info(`Stop percentage: ${stop_percentage.toFixed(2)}%`);
		}
		if (this.buyPrice && this.targetPrice) {
			target_percentage = BigNumber(this.targetPrice).minus(this.buyPrice).dividedBy(this.buyPrice).times(100);
			this.logger.info(`Target percentage: ${target_percentage.toFixed(2)}%`);
		}
		if (stop_percentage && target_percentage) {
			let risk_reward_ratio = target_percentage.dividedBy(stop_percentage);
			this.logger.info(`Risk/reward ratio: ${risk_reward_ratio.toFixed(1)}`);
		}
		if (
			stop_percentage &&
			this.trading_rules &&
			this.trading_rules.max_allowed_portfolio_loss_percentage_per_trade
		) {
			this.max_portfolio_percentage_allowed_in_this_trade = BigNumber(
				this.trading_rules.max_allowed_portfolio_loss_percentage_per_trade
			)
				.dividedBy(stop_percentage)
				.times(100);
			this.logger.info(
				`Max portfolio % allowed in trade: ${this.max_portfolio_percentage_allowed_in_this_trade.toFixed(1)}%`
			);
		}
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

	async monitor_user_stream() {
		let obj = this;
		function checkOrderFilled(data, orderFilled) {
			const { symbol, price, quantity, side, orderType, orderId, orderStatus } = data;

			obj.logger.info(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`);
			obj.logger.info(`..price: ${price}, quantity: ${quantity}`);

			if (orderStatus === 'NEW' || orderStatus === 'PARTIALLY_FILLED') {
				return;
			}

			if (orderStatus !== 'FILLED') {
				throw new Error(`Order ${orderStatus}. Reason: ${data.r}`);
			}

			orderFilled(data);
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

	async main() {
		try {
			this.exchange_info = await this.ee.exchangeInfo();
			this.algo_utils.set_exchange_info(this.exchange_info);
		} catch (error) {
			async_error_handler(this.logger, 'Error could not pull exchange info', error);
		}

		try {
			if (typeof this.buyPrice !== 'undefined') {
				this.buyPrice = BigNumber(this.buyPrice);
				// buyPrice of zero is special case to denote market buy
				if (!this.buyPrice.isZero()) {
					if (typeof this.quoteAmount !== 'undefined') {
						this.amount = BigNumber(this.quoteAmount).dividedBy(this.buyPrice);
						this.logger.info(`Calculated buy amount ${this.amount.toFixed()} (unmunged)`);
					}
				}
			}

			if (typeof this.stopPrice !== 'undefined') {
				this.stopPrice = BigNumber(this.stopPrice);
			}

			if (typeof this.targetPrice !== 'undefined') {
				this.targetPrice = BigNumber(this.targetPrice);
			}

			if (!this.amount && !this.auto_size) {
				let msg = 'You must specify amount with -a, -q or use --auto-size';
				this.logger.error(msg);
				throw new Error(msg);
			}

			this.calculate_percentages();
			if (this.percentages) process.exit();

			this.send_message(
				`${this.virtualPair} New trade buy: ${this.buyPrice}, stop: ${this.stopPrice}, target: ${this
					.targetPrice}`
			);

			await this.monitor_user_stream();
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
			let innerPrice, outerPrice, currentPrice;
			this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.innerPair, this.outerPair ], async function(
				trade
			) {
				var { symbol, price } = trade;
				assert(symbol);
				assert(price);
				console.log(`Trade: ${symbol}`);

				price = BigNumber(price);

				if (symbol === obj.outerPair) {
					outerPrice = price;
				} else if (symbol === obj.innerPair) {
					innerPrice = price;
				} else {
					console.error(`Unexpected pair in trades stream ${pair}`);
				}

				if (typeof innerPrice === 'undefined' || typeof outerPrice === 'undefined') {
					return;
				}

				currentPrice = innerPrice.times(outerPrice);
				obj.logger.info(`Virtual pair price: ${currentPrice.toFixed()}`);

				// 	if (waiting_for_soft_entry_price) {
				// TODO: holy shit we would buy below the stop price
				// 		if (price.isLessThanOrEqualTo(obj.buyPrice)) {
				// 			waiting_for_soft_entry_price = false;
				// 			obj.send_message(`${symbol} soft entry buy price hit`);
				// 			obj.buyOrderId = await obj._create_limit_buy_order();
				// 		}
				// 	} else if (obj.buyOrderId) {
				// 		// obj.logger.info(`${symbol} trade update. price: ${price} buy: ${obj.buyPrice}`);
				// 	} else if (obj.stopOrderId || obj.targetOrderId) {
				// 		// obj.logger.info(
				// 		// 	`${symbol} trade update. price: ${price} stop: ${obj.stopPrice} target: ${obj.targetPrice}`
				// 		// );
				// 		if (
				// 			obj.stopOrderId &&
				// 			!obj.targetOrderId &&
				// 			price.isGreaterThanOrEqualTo(obj.targetPrice) &&
				// 			!isCancelling
				// 		) {
				// 			obj.logger.info(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
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
				// 			price.isLessThanOrEqualTo(obj.stopPrice) &&
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
