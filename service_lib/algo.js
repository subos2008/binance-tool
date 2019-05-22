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
			base_amount, // can be either the amount to buy or sell depending on other args
			max_quote_amount_to_buy,
			buy_price,
			stop_price,
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
		this.logger = logger;
		assert(send_message);
		assert(pair);

		this.ee = ee;
		this.send_message = send_message;
		this.pair = pair;
		if (max_quote_amount_to_buy) {
			max_quote_amount_to_buy = BigNumber(max_quote_amount_to_buy);
			this.max_quote_amount_to_buy = max_quote_amount_to_buy;
		}
		if (buy_price) {
			buy_price = BigNumber(buy_price);
			this.buy_price = BigNumber(buy_price);
			if (base_amount) this.base_amount_to_buy = BigNumber(base_amount);
		} else {
			if (base_amount) this.base_amount_held = BigNumber(base_amount);
		}
		if (stop_price) {
			stop_price = BigNumber(stop_price);
			this.stop_price = BigNumber(stop_price);
		}
		if (limit_price) {
			limit_price = BigNumber(limit_price);
			this.limit_price = BigNumber(limit_price);
		}
		if (target_price) {
			target_price = BigNumber(target_price);
			this.target_price = BigNumber(target_price);
		}

		// require that the user at least pass in trading rules, this allows much
		// more solid code downstream as we can assert that the trading_rules are present,
		// otherwise we would ignore them if they were undefined which leaves the potential
		// for massive fuckups
		assert(trading_rules);

		this.nonBnbFees = nonBnbFees;
		this.soft_entry = soft_entry;
		this.trading_rules = trading_rules;
		this.auto_size = auto_size;
		this.percentages = percentages;

		this.algo_utils = new AlgoUtils({ logger, ee });

		this.pair = pair = this.pair.toUpperCase();
		let { quote_currency, base_currency } = this.algo_utils.split_pair(pair);
		this.quote_currency = quote_currency;
		this.base_currency = base_currency;
		if (buy_price && stop_price && !buy_price.isZero()) assert(stop_price.isLessThan(buy_price));
		if (target_price && buy_price) assert(target_price.isGreaterThan(buy_price));
		if (target_price && stop_price) assert(target_price.isGreaterThan(stop_price));
		this.position_sizer = new PositionSizer({ logger, ee, trading_rules });

		this.logger.warn(`WARNING: STOP_LOSS_LIMIT orders need work`);
	}

	print_percentages_for_user({ current_price } = {}) {
		let { buy_price, stop_price, target_price, trading_rules } = this;
		if (current_price) {
			assert(BigNumber.isBigNumber(current_price));
			buy_price = current_price;
		}
		this.algo_utils.calculate_percentages({
			buy_price,
			stop_price,
			target_price,
			trading_rules
		});
	}

	shutdown_streams() {
		if (this.closeUserWebsocket) this.closeUserWebsocket();
		if (this.closeTradesWebSocket) this.closeTradesWebSocket();
	}

	async size_position({ current_price, position_sizer_options } = { position_sizer_options: {} }) {
		if (current_price) current_price = BigNumber(current_price); // rare usage, be resilient
		let {
			trading_rules,
			auto_size,
			stop_price,
			buy_price,
			quote_currency,
			max_quote_amount_to_buy,
			base_amount_to_buy
		} = this;

		// this is kind of a corner case when the base_amount is specified for a buy order
		// Do we want the position sizer to fiqure out if we have enough quote to buy that much
		// base? For the moment as Algos are unlikely to use this we just return it directly, the
		// user will see on the command line if there was an issue
		if (base_amount_to_buy) {
			return { base_amount: base_amount_to_buy };
		}

		if (buy_price.isZero() && !current_price) {
			this.logger.info(`Sizing market buy using current market price.`);
			let prices = await this.ee.prices();
			current_price = BigNumber(prices[this.pair]);
		}

		buy_price = current_price ? current_price : buy_price;
		assert(buy_price);
		try {
			let { base_amount, quote_volume } = await this.position_sizer.size_position(
				Object.assign(
					{
						trading_rules,
						auto_size,
						buy_price,
						stop_price,
						quote_currency,
						max_quote_amount_to_buy
					},
					position_sizer_options
				)
			);
			assert(base_amount);
			this.logger.info(
				`Sized trade at ${quote_volume} ${this.quote_currency}, ${base_amount} ${this.base_currency}`
			);
			return { quote_volume, base_amount };
		} catch (error) {
			async_error_handler(console, `sizing position`, error);
		}
	}

	async _create_limit_buy_order() {
		try {
			assert(!this.buyOrderId);
			assert(this.buy_price && !this.buy_price.isZero());
			let price = this.buy_price;
			let { base_amount } = await this.size_position();
			base_amount = this._munge_amount_and_check_notionals({ base_amount, price });
			let response = await this.algo_utils.create_limit_buy_order({
				pair: this.pair,
				base_amount,
				price
			});
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	}

	async _create_limit_sell_order({ price, base_amount } = {}) {
		assert(price);
		assert(base_amount);
		try {
			base_amount = this.base_amount_held;
			base_amount = this._munge_amount_and_check_notionals({ base_amount, price });
			let response = await this.algo_utils.create_limit_sell_order({
				pair: this.pair,
				base_amount,
				price
			});
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Sell error: ${error.body}`, error);
		}
	}

	async _create_stop_loss_limit_sell_order({ limit_price_factor } = { limit_price_factor: BigNumber('0.8') }) {
		assert(limit_price_factor);
		assert(this.stop_price);
		assert(this.base_amount_held);
		assert(!this.base_amount_held.isZero());
		try {
			let base_amount = this.base_amount_held;
			base_amount = this._munge_amount_and_check_notionals({ base_amount, stop_price: this.stop_price });
			let price = this.limit_price;
			if (!price) {
				this.logger.warn(`STOP_LIMIT_SELL order using default limit_price_factor of ${limit_price_factor}`);
				price = this.stop_price.times(limit_price_factor);
			}
			let response = await this.algo_utils.create_stop_loss_limit_sell_order({
				pair: this.pair,
				base_amount,
				price,
				stop_price: this.stop_price
			});
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Sell error: ${error.body}`, error);
		}
	}

	async _create_market_buy_order() {
		try {
			assert(!this.buyOrderId);
			let { base_amount } = await this.size_position();
			base_amount = this._munge_amount_and_check_notionals({ base_amount, buy_price: this.buy_price });
			let response = this.algo_utils.create_market_buy_order({ base_amount, pair: this.pair });
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	}
	async monitor_user_stream() {
		let obj = this;
		async function checkOrderFilled(data, orderFilled) {
			const { symbol, price, quantity, side, orderType, orderId, orderStatus } = data;

			obj.logger.info(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`);
			obj.logger.info(`..price: ${price}, quantity: ${quantity}`);

			if (orderStatus === 'NEW' || orderStatus === 'PARTIALLY_FILLED') {
				return;
			}

			if (orderStatus !== 'FILLED') {
				throw new Error(`Order ${orderStatus}. Reason: ${data.r}`);
			}

			try {
				await orderFilled(data);
			} catch (error) {
				async_error_handler(obj.logger, `error placing order: ${error.body}`, error);
			}
		}

		this.closeUserWebsocket = await this.ee.ws.user(async (data) => {
			try {
				const { orderId, eventType } = data;
				if (eventType !== 'executionReport') {
					return;
				}
				obj.logger.info(`.ws.user recieved:`);
				obj.logger.info(data);

				if (orderId === obj.buyOrderId) {
					await checkOrderFilled(data, async () => {
						obj.buyOrderId = undefined;
						this.base_amount_held = BigNumber(data.totalTradeQuantity);
						this.send_message(`${data.symbol} buy order filled`);
						await obj.placeSellOrder();
					});
				} else if (orderId === obj.stopOrderId) {
					await checkOrderFilled(data, async () => {
						this.send_message(`${data.symbol} stop loss order filled`);
						await obj.execution_complete(`Stop hit`, 1);
					});
				} else if (orderId === obj.targetOrderId) {
					await checkOrderFilled(data, async () => {
						this.send_message(`${data.symbol} target sell order filled`);
						await obj.execution_complete(`Target hit`);
					});
				}
			} catch (error) {
				let msg = `SHIT: error placing orders for pair ${this.pair}: error`;
				this.logger.error(msg);
				this.logger.error(error);
				this.send_message(msg);
			}
		});
	}

	execution_complete(msg, exit_code = 0) {
		this.logger.info(`ExecutionComplete: ${msg}`);
		if (exit_code) process.exitCode = exit_code;
		this.shutdown_streams();
	}

	_munge_amount_and_check_notionals({ base_amount }) {
		let { pair, buy_price, stop_price, target_price, limit_price } = this;
		assert(base_amount);
		if (buy_price && buy_price.isZero()) buy_price = undefined;
		return this.algo_utils.munge_amount_and_check_notionals({
			pair,
			base_amount,
			buy_price,
			stop_price,
			target_price,
			limit_price
		});
	}

	async placeStopOrder() {
		try {
			this.logger.warn(
				`Need to add code to create a market sell if STOP_LOSS_LIMIT order is rejected by exchange.`
			);
			let orderId = await this._create_stop_loss_limit_sell_order();
			this.logger.info(`order id: ${orderId}`);
			return orderId;
		} catch (error) {
			async_error_handler(this.logger, `error placing order: ${error.body}`, error);
		}
	}

	async placeTargetOrder() {
		try {
			return await this._create_limit_sell_order({
				price: this.target_price,
				base_amount: this.base_amount_held
			});
		} catch (error) {
			async_error_handler(console, `error placing target sell order: ${error.body}`, error);
		}
	}

	async placeSellOrder() {
		if (this.stop_price) {
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

			if (this.buy_price) {
				// buy_price of zero is special case to denote market buy
				if (!this.buy_price.isZero()) {
					this.buy_price = utils.munge_and_check_price({ exchange_info, symbol, price: this.buy_price });
				}
			}

			if (this.stop_price) {
				this.stop_price = utils.munge_and_check_price({ exchange_info, symbol, price: this.stop_price });
			}

			if (this.target_price) {
				this.target_price = utils.munge_and_check_price({ exchange_info, symbol, price: this.target_price });
			}

			let buy_msg = this.buy_price ? `buy: ${this.buy_price}` : '';
			let stop_msg = this.stop_price ? `stop: ${this.stop_price}` : '';
			let target_msg = this.target_price ? `target: ${this.target_price}` : '';
			this.send_message(`${this.pair} New trade: ${buy_msg} ${stop_msg} ${target_msg}`);
			await this.monitor_user_stream();
		} catch (error) {
			this.logger.error(error);
			throw new Error(`exception in setup code: ${error}`);
			// async_error_handler(undefined, `exception in setup code: ${error.body}`, error);
		}

		try {
			let pair = this.pair;
			let waiting_for_soft_entry_price = false;
			if (this.buy_price) {
				if (this.buy_price.isZero()) {
					if (this.soft_entry) {
						let msg = `Soft entry mode requires specified buy price`;
						this.logger.error(msg);
						throw new Error(msg);
					}
					this.buyOrderId = await this._create_market_buy_order();
				} else {
					if (this.soft_entry) {
						this.logger.info(`Soft entry mode: waiting for entry price before playing order`);
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
			// or we are monitoring for a soft_entry buy price. Soft entry means don't create buy
			// order until until buy_price is hit
			// TODO: in some cases we could close this stream when we no longer need it
			if ((this.stop_price && this.target_price) || this.soft_entry) {
				let obj = this;
				this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.pair ], async function(trade) {
					var { symbol, price } = trade;
					assert(symbol);
					assert(price);
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
						// 	`${symbol} trade update. price: ${price} stop: ${obj.stop_price} target: ${obj.target_price}`
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
								let stopOrderId = obj.stopOrderId;
								obj.stopOrderId = undefined; // Do before await cancelOrder
								await obj.ee.cancelOrder({ symbol, orderId: stopOrderId });
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
							price.isLessThanOrEqualTo(obj.stop_price) &&
							!isCancelling
						) {
							isCancelling = true;
							try {
								let targetOrderId = obj.targetOrderId;
								obj.targetOrderId = undefined; // Do before await cancelOrder
								await obj.ee.cancelOrder({ symbol, orderId: targetOrderId });
								isCancelling = false;
							} catch (error) {
								console.error(`${symbol} cancel error:`, error.body);
								return;
							}
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
