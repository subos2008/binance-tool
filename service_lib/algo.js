const async_error_handler = require('../lib/async_error_handler');
const { ExitNow, ExecutionComplete } = require('../lib/errors');
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
			nonBnbFees
		} = {}
	) {
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

		assert(logger);
		assert(send_message);

		if (this.buyPrice === '') {
			this.buyPrice = '0';
		}

		if (this.quoteAmount && this.buyPrice && this.buyPrice != 0) {
			this.amount = BigNumber(this.quoteAmount).dividedBy(this.buyPrice);
			this.logger.info(`Calculated buy amount ${this.amount.toFixed()}`);
		}

		if (!this.amount) {
			let msg = 'You must specify amount with -a or via -q';
			this.logger.error(msg);
			throw new Error(msg);
		}

		this.pair = this.pair.toUpperCase();
	}

	shutdown_streams() {
		if (this.closeUserWebsocket) this.closeUserWebsocket();
		if (this.closeTradesWebSocket) this.closeTradesWebSocket();
	}

	async _create_market_buy_order() {
		try {
			let args = {
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

	async _create_limit_buy_order() {
		try {
			let args = {
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
			const { orderId } = data;

			obj.logger.info(`.ws.user recieved:`);
			obj.logger.info(data);

			if (orderId === obj.buyOrderId) {
				checkOrderFilled(data, () => {
					obj.buyOrderId = 0;
					obj.placeSellOrder();
				});
			} else if (orderId === obj.stopOrderId) {
				checkOrderFilled(data, () => {
					// TODO: handle these exceptions. Msg user, call softexit?
					throw new ExecutionComplete(`Stop hit`);
				});
			} else if (orderId === obj.targetOrderId) {
				checkOrderFilled(data, () => {
					throw new ExecutionComplete(`Target hit`);
				});
			}
		});
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
			throw new ExecutionComplete();
		}
	}

	async main() {
		try {
			await this.monitor_user_stream();
			await this.munge_prices_and_amounts();

			const NON_BNB_TRADING_FEE = BigNumber('0.001');

			// const calculateSellAmount = function(commissionAsset, sellAmount) {
			// 	// Adjust sell amount if BNB not used for trading fee
			// 	return commissionAsset === 'BNB' && !this.nonBnbFees
			// 		? sellAmount
			// 		: sellAmount.times(BigNumber(1).minus(NON_BNB_TRADING_FEE));
			// };

			// const sellComplete = function(error, response) {
			// 	if (error) {
			// 		throw new Error('Sell error', error.body);
			// 	}

			// 	this.logger.info('Sell response', response);
			// 	this.logger.info(`order id: ${response.orderId}`);

			// 	if (!(this.stopPrice && this.targetPrice)) {
			// 		throw new ExecutionComplete();
			// 	}

			// 	if (response.type === 'STOP_LOSS_LIMIT') {
			// 		this.send_message(`${this.pair} stopped out`);
			// 		this.stopOrderId = response.orderId;
			// 	} else if (response.type === 'LIMIT') {
			// 		this.send_message(`${this.pair} hit target price`);
			// 		this.targetOrderId = response.orderId;
			// 	}
			// };

			if (typeof this.buyPrice !== 'undefined') {
				if (this.buyPrice.isZero()) {
					this.buyOrderId = await this._create_market_buy_order();
				} else {
					this.buyOrderId = await this._create_limit_buy_order();
				}
			} else {
				await this.placeSellOrder();
			}

			// TODO: I guess it would be good to check how much the balance is on the exchange
			// against 'amount' if there is no buy stage

			// this.logger.info(`BuyPrice: ${this.buyPrice}, isZero(): ${this.buyPrice.isZero()}`);
			// if (typeof this.buyPrice !== 'undefined') {
			// 	if (this.buyPrice.isZero()) {
			// 		this.buyOrderId = await this._create_market_buy_order();
			// TODO: move this code
			// 	} else if (this.buyPrice.isGreaterThan(0)) {
			// 		old_binance.prices(this.pair, (error, ticker) => {
			// 			const currentPrice = ticker[this.pair];
			// 			this.logger.info(`${this.pair} price: ${currentPrice}`);

			// 				isLimitEntry = true;
			// 				console.error('needs implementing');
			// 				throw new Error('backtrace me');
			// 		});
			// 	}
			// } else {
			// 	placeSellOrder();
			// }

			let isCancelling = false;

			// TODO: we don't always need this - only if we have stop and target orders that need monitoring
			if (this.stopPrice && this.targetPrice) {
				let obj = this;
				this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.pair ], async function(trade) {
					var { symbol, price } = trade;
					assert(symbol);
					assert(price);

					obj.logger.info('------------');
					obj.logger.info(`.ws.aggTrades recieved:`);
					obj.logger.info(trade);
					obj.logger.info(`stopOrderId: ${obj.stopOrderId}`);
					obj.logger.info('------------');
					price = BigNumber(price);

					if (obj.buyOrderId) {
						obj.logger.info(`${symbol} trade update. price: ${price} buy: ${obj.buyPrice}`);
					} else if (obj.stopOrderId || obj.targetOrderId) {
						obj.logger.info(
							`${symbol} trade update. price: ${price} stop: ${obj.stopPrice} target: ${obj.targetPrice}`
						);
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
