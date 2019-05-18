const async_error_handler = require('../lib/async_error_handler');
const { ExitNow } = require('../lib/errors');
const StateMachine = require('javascript-state-machine');
const BigNumber = require('bignumber.js');
const utils = require('../lib/utils');
const assert = require('assert');
const PositionSizer = require('./position_sizer');
const AlgoUtils = require('./algo_utils');

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
			pair,
			amount,
			quoteAmount,
			buy_price,
			stopPrice,
			limit_price,
			target_price,
			nonBnbFees,
			soft_entry,
			trading_rules,
			auto_size,
			percentages
		} = {}
	) {
		assert(logger);
		assert(send_message);
		assert(pair);

		this.ee = ee;
		this.send_message = send_message;
		this.pair = pair;
		this.amount = amount;
		this.quoteAmount = quoteAmount;
		if (buy_price) this.buy_price = BigNumber(buy_price);
		if (stopPrice) this.stopPrice = BigNumber(stopPrice);
		if (limit_price) this.limit_price = BigNumber(limit_price);
		if (target_price) this.target_price = BigNumber(target_price);
		this.nonBnbFees = nonBnbFees;
		this.logger = logger;
		this.soft_entry = soft_entry;
		this.trading_rules = trading_rules;
		this.auto_size = auto_size;
		this.percentages = percentages;

		this.pair = this.pair.toUpperCase();
		this.quote_currency = utils.quote_currency_for_binance_pair(this.pair);
		if (buy_price && stopPrice && !buy_price.isZero()) assert(stopPrice.isLessThan(buy_price));
		if (target_price && buy_price) assert(target_price.isGreaterThan(buy_price));
		if (target_price && stopPrice) assert(target_price.isGreaterThan(stopPrice));
		this.algo_utils = new AlgoUtils({ logger, ee });
	}

	calculate_percentages() {
		let { buy_price, stopPrice, target_price, trading_rules } = this;
		this.max_portfolio_percentage_allowed_in_this_trade = this.algo_utils.calculate_percentages({
			buy_price,
			stopPrice,
			target_price,
			trading_rules
		});
	}

	shutdown_streams() {
		if (this.closeUserWebsocket) this.closeUserWebsocket();
		if (this.closeTradesWebSocket) this.closeTradesWebSocket();
	}

	async _create_market_buy_order() {
		try {
			let args = {
				useServerTime: true,
				side: 'BUY',
				symbol: this.pair,
				type: 'MARKET',
				quantity: this.amount.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			this.logger.info(`Creating MARKET BUY ORDER`);
			// this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info('MARKET BUY response', response);
			this.logger.info(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
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
							// this.logger.warn(
							// 	`Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
							// );
						}
					} catch (e) {
						// this.logger.warn(
						// 	`Non fatal error: unable to convert ${balance.asset} value to ${quote_currency}, skipping`
						// );
					}
				}
			});
			return { available, total };
		} catch (error) {
			async_error_handler(console, `calculating portfolio value`, error);
		}
	}

	async _calculate_autosized_quote_volume_available() {
		assert(this.max_portfolio_percentage_allowed_in_this_trade);
		assert(BigNumber.isBigNumber(this.max_portfolio_percentage_allowed_in_this_trade));
		let quote_portfolio;
		try {
			quote_portfolio = await this._get_portfolio_value_from_exchange({
				quote_currency: this.quote_currency
			});
		} catch (error) {
			async_error_handler(console, `Autosizing error during portfolio sizing: ${error.body}`, error);
		}
		assert(BigNumber.isBigNumber(quote_portfolio.total));
		assert(BigNumber.isBigNumber(quote_portfolio.available));
		let max_quote_amount_to_invest = quote_portfolio.total
			.times(this.max_portfolio_percentage_allowed_in_this_trade)
			.dividedBy(100);
		this.logger.info(`Max allowed to invest: ${max_quote_amount_to_invest} ${this.quote_currency}`);
		this.logger.info(`Available to invest: ${quote_portfolio.available} ${this.quote_currency}`);
		return BigNumber.minimum(max_quote_amount_to_invest, quote_portfolio.available);
	}

	async _create_limit_buy_order() {
		try {
			if (this.auto_size) {
				let quote_volume = await this._calculate_autosized_quote_volume_available();
				this.amount = utils.quote_volume_at_price_to_base_volume({
					quote_volume,
					price: this.buy_price
				});
				this._munge_amount_and_check_notionals();
			}
		} catch (error) {
			async_error_handler(console, `Autosizing error during limit buy order: ${error.body}`, error);
		}
		try {
			let args = {
				useServerTime: true,
				side: 'BUY',
				symbol: this.pair,
				type: 'LIMIT',
				quantity: this.amount.toFixed(),
				price: this.buy_price.toFixed()
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

	execution_complete(msg, exit_code = 0) {
		this.logger.info(`ExecutionComplete: ${msg}`);
		if (exit_code) process.exitCode = exit_code;
		this.shutdown_streams();
	}

	_munge_amount_and_check_notionals() {
		let { pair, amount, buy_price, stopPrice, target_price, limit_price } = this;
		if (buy_price && buy_price.isZero()) buy_price = undefined;
		this.amount = this.algo_utils.munge_amount_and_check_notionals({
			pair,
			amount,
			buy_price,
			stopPrice,
			target_price,
			limit_price
		});
	}

	async placeStopOrder() {
		try {
			let args = {
				useServerTime: true,
				side: 'SELL',
				symbol: this.pair,
				type: 'STOP_LOSS_LIMIT',
				quantity: this.amount.toFixed(),
				price: (this.limit_price || this.stopPrice).toFixed(),
				stopPrice: this.stopPrice.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			this.logger.info(`Creating STOP_LOSS_LIMIT SELL ORDER`);
			this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info('STOP_LOSS_LIMIT sell response', response);
			this.logger.info(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `error placing order: ${error.body}`, error);
		}
	}

	async placeTargetOrder() {
		try {
			let args = {
				useServerTime: true,
				side: 'SELL',
				symbol: this.pair,
				type: 'LIMIT',
				quantity: this.amount.toFixed(),
				price: this.target_price.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			this.logger.info(`Creating Target LIMIT SELL ORDER`);
			this.logger.info(args);
			let response = await this.ee.order(args);
			this.logger.info('Target LIMIT SELL response', response);
			this.logger.info(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `error placing order: ${error.body}`, error);
		}
	}

	async placeSellOrder() {
		if (this.stopPrice) {
			try {
				this.stopOrderId = await this.placeStopOrder();
				this.logger.info(`Set stopOrderId: ${this.stopOrderId}`);
			} catch (error) {
				async_error_handler(console, `error placing order: ${error.body}`, error);
			}
		} else if (this.target_price) {
			try {
				this.targetOrderId = await this.placeTargetOrder();
				this.logger.info(`Set targetOrderId: ${this.targetOrderId}`);
			} catch (error) {
				async_error_handler(console, `error placing order: ${error.body}`, error);
			}
		} else {
			this.execution_complete('buy completed and no sell actions defined');
		}
	}

	async main() {
		try {
			this.exchange_info = await this.ee.exchangeInfo();
			this.algo_utils.set_exchange_info(this.exchange_info);
		} catch (error) {
			async_error_handler(this.logger, 'Error could not pull exchange info', error);
		}

		try {
			let exchange_info = this.exchange_info;
			let symbol = this.pair;
			// TODO: munge buy_price here
			// TODO: if x & x!=0 looks like redundant logic
			if (typeof this.buy_price !== 'undefined') {
				this.buy_price = BigNumber(this.buy_price);
				// buy_price of zero is special case to denote market buy
				if (!this.buy_price.isZero()) {
					this.buy_price = utils.munge_and_check_price({ exchange_info, symbol, price: this.buy_price });
					if (typeof this.quoteAmount !== 'undefined') {
						this.amount = BigNumber(this.quoteAmount).dividedBy(this.buy_price);
						assert(this.amount.isFinite());
						this.logger.info(`Calculated buy amount ${this.amount.toFixed()} (unmunged)`);
					}
				}
			}

			if (typeof this.stopPrice !== 'undefined') {
				this.stopPrice = utils.munge_and_check_price({ exchange_info, symbol, price: this.stopPrice });
			}

			if (typeof this.target_price !== 'undefined') {
				this.target_price = utils.munge_and_check_price({ exchange_info, symbol, price: this.target_price });
			}

			if (this.auto_size && this.buy_price && this.buy_price.isZero()) {
				try {
					this.logger.info(`Autosizing market buy using current price`);

					let position_sizer = new PositionSizer({
						logger: this.logger,
						ee: this.ee,
						trading_rules: this.trading_rules
					});
					let current_price = (await this.ee.prices())[this.pair];
					let quote_volume = await position_sizer.size_position_in_quote_currency({
						buy_price: current_price,
						stop_price: this.stopPrice,
						quote_currency: this.quote_currency
					});
					this.logger.info(`Would currently invest ${quote_volume} ${this.quote_currency}`);
					this.amount = quote_volume.dividedBy(current_price);
					assert(this.amount.isFinite());
					this.logger.info(`Calculated buy amount ${this.amount.toFixed()} (unmunged)`);
				} catch (error) {
					async_error_handler(this.logger, `Error auto-sizing spot buy:`, error);
				}
			}

			if (!this.amount && !this.auto_size) {
				let msg = 'You must specify amount with -a, -q or use --auto-size';
				this.logger.error(msg);
				throw new Error(msg);
			}

			this._munge_amount_and_check_notionals();

			this.calculate_percentages();
			try {
				// trigger printing out the current status
				let qv = await this._calculate_autosized_quote_volume_available();
				console.log(`Would currently invest ${qv} ${this.quote_currency}`);
			} catch (e) {
				/* do nothing */
			}
			if (this.percentages) process.exit();

			let buy_msg = this.buy_price ? `buy: ${this.buy_price}` : '';
			let stop_msg = this.stopPrice ? `stop: ${this.stopPrice}` : '';
			let target_msg = this.target_price ? `target: ${this.target_price}` : '';
			this.send_message(`${this.pair} New trade: ${buy_msg} ${stop_msg} ${target_msg}`);
			await this.monitor_user_stream();

			const NON_BNB_TRADING_FEE = BigNumber('0.001'); // TODO: err why is this unused
		} catch (error) {
			this.logger.error(error);
			throw new Error('exception in setup code');
			// async_error_handler(undefined, `exception in setup code: ${error.body}`, error);
		}

		try {
			let waiting_for_soft_entry_price = false;
			if (typeof this.buy_price !== 'undefined') {
				if (this.buy_price.isZero()) {
					if (this.soft_entry) {
						let msg = `Soft entry mode requires specified buy price`;
						this.logger.error(msg);
						throw new Error(msg);
					}
					this.buyOrderId = await this._create_market_buy_order();
				} else {
					if (this.soft_entry) {
						this.logger.info(`Soft entry mode`);
						waiting_for_soft_entry_price = true;
					} else {
						this.buyOrderId = await this._create_limit_buy_order();
					}
				}
			} else {
				await this.placeSellOrder();
			}

			let isCancelling = false;

			// TODO: we don't always need this - only if we have stop and target orders that need monitoring
			if ((this.stopPrice && this.target_price) || this.soft_entry) {
				let obj = this;
				this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.pair ], async function(trade) {
					var { symbol, price } = trade;
					assert(symbol);
					assert(price);

					// obj.logger.info('------------');
					// obj.logger.info(`.ws.aggTrades recieved:`);
					// obj.logger.info(trade);
					// obj.logger.info(`stopOrderId: ${obj.stopOrderId}`);
					// obj.logger.info('------------');
					price = BigNumber(price);

					if (waiting_for_soft_entry_price) {
						if (price.isLessThanOrEqualTo(obj.buy_price)) {
							waiting_for_soft_entry_price = false;
							obj.send_message(`${symbol} soft entry buy price hit`);
							obj.buyOrderId = await obj._create_limit_buy_order();
						}
					} else if (obj.buyOrderId) {
						// obj.logger.info(`${symbol} trade update. price: ${price} buy: ${obj.buy_price}`);
					} else if (obj.stopOrderId || obj.targetOrderId) {
						// obj.logger.info(
						// 	`${symbol} trade update. price: ${price} stop: ${obj.stopPrice} target: ${obj.target_price}`
						// );
						if (
							typeof obj.target_price !== 'undefined' &&
							obj.stopOrderId &&
							!obj.targetOrderId &&
							price.isGreaterThanOrEqualTo(obj.target_price) &&
							!isCancelling
						) {
							obj.logger.info(`Event: price >= target_price: cancelling stop and placeTargetOrder()`);
							isCancelling = true;
							try {
								await obj.ee.cancelOrder({ symbol, orderId: obj.stopOrderId });
								obj.stopOrderId = 0;
								isCancelling = false;
							} catch (error) {
								console.error(`${symbol} cancel error:`, error.body);
								console.error(error);
								return;
							}
							try {
								obj.targetOrderId = await obj.placeTargetOrder();
								obj.logger.info(`Set targetOrderId: ${obj.targetOrderId}`);
							} catch (error) {
								async_error_handler(console, `error placing order: ${error.body}`, error);
							}
						} else if (
							obj.targetOrderId &&
							!obj.stopOrderId &&
							price.isLessThanOrEqualTo(obj.stopPrice) &&
							!isCancelling
						) {
							isCancelling = true;
							try {
								await obj.ee.cancelOrder({ symbol, orderId: obj.targetOrderId });
								isCancelling = false;
							} catch (error) {
								console.error(`${symbol} cancel error:`, error.body);
								return;
							}
							obj.targetOrderId = 0;
							obj.logger.info(`${symbol} cancel response:`, response);
							try {
								obj.stopOrderId = await obj.placeStopOrder();
								obj.logger.info(`Set stopOrderId: ${obj.stopOrderId}`);
							} catch (error) {
								async_error_handler(console, `error placing order: ${error.body}`, error);
							}
						}
					}
				});
			}
		} catch (error) {
			async_error_handler(console, `exception in main loop: ${error.body}`, error);
		}
	}
}

module.exports = Algo;
