const async_error_handler = require('../lib/async_error_handler');
const { ExitNow, ExecutionComplete } = require('../lib/errors');
const StateMachine = require('javascript-state-machine');
const BigNumber = require('bignumber.js');
const utils = require('../lib/utils');

class Algo {
	// All numbers are expected to be passed in as strings
	constructor(
		{
			ee, // binance-api-node API
			send_message,
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

		if (this.buyPrice === '') {
			this.buyPrice = '0';
		}

		if (this.quoteAmount && this.buyPrice && this.buyPrice != 0) {
			this.amount = BigNumber(this.quoteAmount).dividedBy(this.buyPrice);
			console.log(`Calculated buy amount ${this.amount.toFixed()}`);
		}

		if (!this.amount) {
			let msg = 'You must specify amount with -a or via -q';
			console.error();
			throw new Error(msg);
		}

		this.pair = this.pair.toUpperCase();

		this.buyOrderId = 0;
		this.stopOrderId = 0;
		this.targetOrderId = 0;
	}

	shutdown_streams() {
		if (this.closeUserWebsocket) this.closeUserWebsocket();
		if (this.closeTradesWebSocket) this.closeTradesWebSocket();
	}

	async main() {
		this.closeUserWebsocket = await this.ee.ws.user((data) => {
			const { i: orderId } = data;

			if (orderId === this.buyOrderId) {
				checkOrderFilled(data, () => {
					const { N: commissionAsset } = data;
					this.buyOrderId = 0;
					fsm.buyOrderFilled();
				});
			} else if (orderId === this.stopOrderId) {
				checkOrderFilled(data, () => {
					throw new ExecutionComplete(`Stop hit`);
				});
			} else if (orderId === this.targetOrderId) {
				checkOrderFilled(data, () => {
					throw new ExecutionComplete(`Target hit`);
				});
			}
		});

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

		const NON_BNB_TRADING_FEE = BigNumber('0.001');

		const calculateSellAmount = function(commissionAsset, sellAmount) {
			// Adjust sell amount if BNB not used for trading fee
			return commissionAsset === 'BNB' && !this.nonBnbFees
				? sellAmount
				: sellAmount.times(BigNumber(1).minus(NON_BNB_TRADING_FEE));
		};

		const sellComplete = function(error, response) {
			if (error) {
				throw new Error('Sell error', error.body);
			}

			console.log('Sell response', response);
			console.log(`order id: ${response.orderId}`);

			if (!(this.stopPrice && this.targetPrice)) {
				throw new ExecutionComplete();
			}

			if (response.type === 'STOP_LOSS_LIMIT') {
				this.send_message(`${this.pair} stopped out`);
				this.stopOrderId = response.orderId;
			} else if (response.type === 'LIMIT') {
				this.send_message(`${this.pair} hit target price`);
				this.targetOrderId = response.orderId;
			}
		};

		async function placeStopOrder() {
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
				console.log(`Creating STOP_LOSS_LIMIT SELL ORDER`);
				console.log(args);
				let response = await this.ee.order(args);
				console.log('Buy response', response);
				console.log(`order id: ${response.orderId}`);
				return response.orderId;
			} catch (error) {
				async_error_handler(console, `error placing order: ${error.body}`, error);
			}
		}

		async function placeTargetOrder() {
			try {
				let args = {
					side: 'SELL',
					symbol: this.pair,
					type: 'LIMIT',
					quantity: this.amount.toFixed(),
					price: this.targetPrice.toFixed()
					// TODO: more args here, server time and use FULL response body
				};
				console.log(`Creating LIMIT SELL ORDER`);
				console.log(args);
				let response = await this.ee.order(args);
				console.log('Buy response', response);
				console.log(`order id: ${response.orderId}`);
				return response.orderId;
			} catch (error) {
				async_error_handler(console, `error placing order: ${error.body}`, error);
			}
		}

		const placeSellOrder = function() {
			if (this.stopPrice) {
				placeStopOrder();
			} else if (this.targetPrice) {
				placeTargetOrder();
			} else {
				throw new ExecutionComplete();
			}
		};

		async function create_market_buy_order() {
			try {
				let args = {
					side: 'BUY',
					symbol: this.pair,
					type: 'MARKET',
					quantity: this.amount.toFixed()
					// TODO: more args here, server time and use FULL response body
				};
				console.log(`Creating MARKET BUY ORDER`);
				// console.log(args);
				let response = await this.ee.order(args);
				fsm.buyOrderCreated();
				console.log('Buy response', response);
				console.log(`order id: ${response.orderId}`);
				return response.orderId;
			} catch (error) {
				async_error_handler(console, `Buy error: ${error.body}`, error);
			}
		}

		async function create_limit_buy_order() {
			try {
				let args = {
					side: 'BUY',
					symbol: this.pair,
					type: 'LIMIT',
					quantity: this.amount.toFixed(),
					price: this.buyPrice.toFixed()
					// TODO: more args here, server time and use FULL response body
				};
				console.log(`Creating LIMIT BUY ORDER`);
				console.log(args);
				let response = await this.ee.order(args);
				fsm.buyOrderCreated();
				console.log('Buy response', response);
				console.log(`order id: ${response.orderId}`);
				return response.orderId;
			} catch (error) {
				async_error_handler(console, `Buy error: ${error.body}`, error);
			}
		}

		let isLimitEntry = false;
		let isStopEntry = false;

		var fsm = new StateMachine({
			init: 'initialising',
			transitions: [
				{ name: 'buy_order_created', from: 'initialising', to: 'buy_order_open' }, // A
				// { name: 'wait_for_entry_price', from: 'initialising', to: 'waiting_for_entry_price' }, // B
				{ name: 'buy_order_filled', from: 'buy_order_open', to: 'waiting_for_exit_price' } // C
				// { name: 'buy_order_created', from: 'waiting_for_entry_price', to: 'buy_order_open' }
			],
			methods: {
				// TODO: async?
				onWaitingForExitPrice: function() {
					console.log('Entering: waiting_for_exit_price');
					placeSellOrder();
				}
			}
		});

		if (typeof this.buyPrice !== 'undefined') {
			if (this.buyPrice.isZero()) {
				this.buyOrderId = await create_market_buy_order();
			} else {
				this.buyOrderId = await create_limit_buy_order();
			}
		}

		// TODO: I guess it would be good to check how much the balance is on the exchange
		// against 'amount' if there is no buy stage

		if (fsm.is('initialising')) {
			throw new Error(`Unable to determine intial state`);
		}

		// console.log(`BuyPrice: ${this.buyPrice}, isZero(): ${this.buyPrice.isZero()}`);
		// if (typeof this.buyPrice !== 'undefined') {
		// 	if (this.buyPrice.isZero()) {
		// 		this.buyOrderId = await create_market_buy_order();
		// TODO: move this code
		// 	} else if (this.buyPrice.isGreaterThan(0)) {
		// 		old_binance.prices(this.pair, (error, ticker) => {
		// 			const currentPrice = ticker[this.pair];
		// 			console.log(`${this.pair} price: ${currentPrice}`);

		// 				isLimitEntry = true;
		// 				console.error('needs implementing');
		// 				throw new Error('backtrace me');
		// 		});
		// 	}
		// } else {
		// 	placeSellOrder();
		// }

		let isCancelling = false;

		// TODO: we don't always need this - only if we have cancel/stop/target orders the need monitoring
		this.closeTradesWebSocket = await this.ee.ws.aggTrades([ this.pair ], async function(trade) {
			var { s: symbol, p: price } = trade;
			price = BigNumber(price);

			if (this.buyOrderId) {
				// console.log(`${symbol} trade update. price: ${price} buy: ${this.buyPrice}`);
			} else if (this.stopOrderId || this.targetOrderId) {
				// console.log(`${symbol} trade update. price: ${price} stop: ${this.stopPrice} target: ${this.targetPrice}`);
				if (
					this.stopOrderId &&
					!this.targetOrderId &&
					price.isGreaterThanOrEqualTo(this.targetPrice) &&
					!isCancelling
				) {
					console.log(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
					isCancelling = true;
					try {
						await this.ee.cancelOrder({ symbol, orderId: this.stopOrderId });
						isCancelling = false;
					} catch (error) {
						console.error(`${symbol} cancel error:`, error.body);
						return;
					}
					this.stopOrderId = 0;
					console.log(`${symbol} cancel response:`, response);
					placeTargetOrder();
				} else if (
					this.targetOrderId &&
					!this.stopOrderId &&
					price.isLessThanOrEqualTo(this.stopPrice) &&
					!isCancelling
				) {
					isCancelling = true;
					try {
						await this.ee.cancelOrder({ symbol, orderId: this.targetOrderId });
						isCancelling = false;
					} catch (error) {
						console.error(`${symbol} cancel error:`, error.body);
						return;
					}
					this.targetOrderId = 0;
					console.log(`${symbol} cancel response:`, response);
					placeStopOrder();
				}
			}
		});

		const checkOrderFilled = function(data, orderFilled) {
			const { s: symbol, p: price, q: quantity, S: side, o: orderType, i: orderId, X: orderStatus } = data;

			console.log(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`);
			console.log(`..price: ${price}, quantity: ${quantity}`);

			if (orderStatus === 'NEW' || orderStatus === 'PARTIALLY_FILLED') {
				return;
			}

			if (orderStatus !== 'FILLED') {
				throw new Error(`Order ${orderStatus}. Reason: ${data.r}`);
			}

			orderFilled(data);
		};
	}
}

module.exports = Algo;
