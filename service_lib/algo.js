const async_error_handler = require('../lib/async_error_handler');
const { ExitNow } = require('../lib/errors');
const StateMachine = require('javascript-state-machine');
const BigNumber = require('bignumber.js');
const utils = require('../lib/utils');
const assert = require('assert');

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
			buyPrice,
			stopPrice,
			limitPrice,
			targetPrice,
			nonBnbFees,
			soft_entry,
			trading_rules,
			auto_size
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
		this.buyPrice = buyPrice;
		this.stopPrice = stopPrice;
		this.limitPrice = limitPrice;
		this.targetPrice = targetPrice;
		this.nonBnbFees = nonBnbFees;
		this.logger = logger;
		this.soft_entry = soft_entry;
		this.trading_rules = trading_rules;
		this.auto_size = auto_size;

		this.quote_currency = utils.quote_currency_for_binance_pair(this.pair);

		if (this.buyPrice === '') {
			this.buyPrice = '0';
		}

		if (this.quoteAmount && this.buyPrice && this.buyPrice != 0) {
			this.amount = BigNumber(this.quoteAmount).dividedBy(this.buyPrice);
			this.logger.info(`Calculated buy amount ${this.amount.toFixed()}`);
		}

		if (this.auto_size && !this.soft_entry) {
			let msg = 'auto-size may not work without soft-entry';
			this.logger.error(msg);
			throw new Error(msg);
		}

		if (!this.amount && !this.auto_size) {
			let msg = 'You must specify amount with -a, -q or use --auto-size';
			this.logger.error(msg);
			throw new Error(msg);
		}

		this.pair = this.pair.toUpperCase();
		this.calculate_percentages();

		this.send_message(
			`${this.pair} New trade buy: ${this.buyPrice}, stop: ${this.stopPrice}, target: ${this.targetPrice}`
		);
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

	// TODO: only returns the value held in quote currency at the moment.
	// TODO: this is slowly hacking it's way up to returning the equivalent of the
	// TODO: total portfolio in whatever quote currency is supplied
	async _get_portfolio_value_from_exchange({ quote_currency } = {}) {
		assert(quote_currency);
		try {
			let response = await this.ee.accountInfo();
			// TODO: will throw if asset is not present in balances
			let quote_balance = response.balances.find((obj) => obj.asset === this.quote_currency);
			return {
				locked: BigNumber(quote_balance.locked),
				available: BigNumber(quote_balance.free),
				total: BigNumber(quote_balance.locked).plus(quote_balance.free)
			};
		} catch (error) {
			async_error_handler(console, `Getting account info from exchange: ${error.body}`, error);
		}
	}

	async _calculate_autosized_quote_volume_available() {
		assert(this.max_portfolio_percentage_allowed_in_this_trade);
		assert(BigNumber.isBigNumber(this.max_portfolio_percentage_allowed_in_this_trade));
		let info = await this._get_portfolio_value_from_exchange({
			quote_currency: this.quote_currency
		});
		let quote_portfolio_value = info.total;
		assert(BigNumber.isBigNumber(quote_portfolio_value));
		let max_quote_amount_to_invest = quote_portfolio_value
			.times(this.max_portfolio_percentage_allowed_in_this_trade)
			.dividedBy(100);
		let available_quote_amount = info.available;
		return BigNumber.minimum(max_quote_amount_to_invest, available_quote_amount);
	}

	async _create_limit_buy_order() {
		try {
			if (this.auto_size) {
				let quote_volume = await this._calculate_autosized_quote_volume_available();
				this.amount = utils.quote_volume_at_price_to_base_volume({ quote_volume, price: this.buyPrice });
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

	async munge_prices_and_amounts() {
		var exchangeInfoData;
		try {
			exchangeInfoData = await this.ee.exchangeInfo();
		} catch (e) {
			console.error('Error could not pull exchange info');
			console.error(e);
			throw new Error('Error could not pull exchange info');
		}

		const symbolData = exchangeInfoData.symbols.find((ei) => ei.symbol === this.pair);
		if (!symbolData) {
			throw new Error(`Could not pull exchange info for ${this.pair}`);
		}

		const { filters } = symbolData;
		const { stepSize, minQty } = filters.find((eis) => eis.filterType === 'LOT_SIZE');
		const { tickSize, minPrice } = filters.find((eis) => eis.filterType === 'PRICE_FILTER');
		const { minNotional } = filters.find((eis) => eis.filterType === 'MIN_NOTIONAL');

		function munge_and_check_quantity(name, volume) {
			volume = BigNumber(utils.roundStep(BigNumber(volume), stepSize));
			if (volume.isLessThan(minQty)) {
				throw new Error(`${name} ${volume} does not meet minimum order amount ${minQty}.`);
			}
			return volume;
		}

		function munge_and_check_price(name, price) {
			price = BigNumber(price);
			if (price.isZero()) return price; // don't munge zero, special case for market buys
			price = BigNumber(utils.roundTicks(price, tickSize));
			if (price.isLessThan(minPrice)) {
				throw new Error(`${name} ${price} does not meet minimum order price ${minPrice}.`);
			}
			return price;
		}

		function check_notional(name, price, volume) {
			if (price.isZero()) return; // don't check zero, special case for market buys
			let quote_volume = price.times(volume);
			if (quote_volume.isLessThan(minNotional)) {
				throw new Error(
					`${name} does not meet minimum order value ${minNotional} (Buy of ${volume} at ${price} = ${quote_volume}).`
				);
			}
		}

		this.amount = munge_and_check_quantity('Amount', this.amount);

		if (this.buyPrice && this.buyPrice !== 0) {
			this.buyPrice = munge_and_check_price('Buy price', this.buyPrice);
			check_notional('Buy order', this.buyPrice, this.amount);
		}

		if (this.stopPrice) {
			this.stopPrice = munge_and_check_price('Stop price', this.stopPrice);

			if (this.limitPrice) {
				this.limitPrice = munge_and_check_price('Limit price', this.limitPrice);
				check_notional('Stop order', this.limitPrice, this.amount);
			} else {
				check_notional('Stop order', this.stopPrice, this.amount);
			}
		}

		if (this.targetPrice) {
			this.targetPrice = munge_and_check_price('Target price', this.targetPrice);
			check_notional('Target order', this.targetPrice, this.amount);
		}
	}

	async placeStopOrder() {
		try {
			let args = {
				useServerTime: true,
				side: 'SELL',
				symbol: this.pair,
				type: 'STOP_LOSS_LIMIT',
				quantity: this.amount.toFixed(),
				price: (this.limitPrice || this.stopPrice).toFixed(),
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
				price: this.targetPrice.toFixed()
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
		} else if (this.targetPrice) {
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
			await this.monitor_user_stream();
			await this.munge_prices_and_amounts();

			const NON_BNB_TRADING_FEE = BigNumber('0.001'); // TODO: err why is this unused

			let waiting_for_soft_entry_price = false;
			if (typeof this.buyPrice !== 'undefined') {
				if (this.buyPrice.isZero()) {
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
			if ((this.stopPrice && this.targetPrice) || this.soft_entry) {
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
						if (price.isLessThanOrEqualTo(obj.buyPrice)) {
							waiting_for_soft_entry_price = false;
							obj.send_message(`${symbol} soft entry buy price hit`);
							obj.buyOrderId = await obj._create_limit_buy_order();
						}
					} else if (obj.buyOrderId) {
						// obj.logger.info(`${symbol} trade update. price: ${price} buy: ${obj.buyPrice}`);
					} else if (obj.stopOrderId || obj.targetOrderId) {
						// obj.logger.info(
						// 	`${symbol} trade update. price: ${price} stop: ${obj.stopPrice} target: ${obj.targetPrice}`
						// );
						if (
							obj.stopOrderId &&
							!obj.targetOrderId &&
							price.isGreaterThanOrEqualTo(obj.targetPrice) &&
							!isCancelling
						) {
							obj.logger.info(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
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
