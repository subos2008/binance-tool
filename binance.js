#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require('dotenv').config();
const async_error_handler = require('./lib/async_error_handler');
const { ExitNow, ExecutionComplete } = require('./lib/errors');

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

const Binance = require('binance-api-node').default;
const BigNumber = require('bignumber.js');
const send_message = require('./telegram.js');
const StateMachine = require('javascript-state-machine');

/**
        * rounds number with given step
        * @param {float} qty - quantity to round
        * @param {float} stepSize - stepSize as specified by exchangeInfo
        * @return {float} - number
        */
function roundStep(qty, stepSize) {
	// Integers do not require rounding
	if (Number.isInteger(qty)) return qty;
	const qtyString = qty.toFixed(16);
	const desiredDecimals = Math.max(stepSize.indexOf('1') - 1, 0);
	const decimalIndex = qtyString.indexOf('.');
	return parseFloat(qtyString.slice(0, decimalIndex + desiredDecimals + 1));
}

/**
	* rounds price to required precision
	* @param {float} price - price to round
	* @param {float} tickSize - tickSize as specified by exchangeInfo
	* @return {float} - number
	*/
function roundTicks(price, tickSize) {
	const formatter = new Intl.NumberFormat('en-US', {
		style: 'decimal',
		minimumFractionDigits: 0,
		maximumFractionDigits: 8
	});
	const precision = formatter.format(tickSize).split('.')[1].length || 0;
	if (typeof price === 'string') price = parseFloat(price);
	return price.toFixed(precision);
}

const { argv } = require('yargs')
	.usage('Usage: $0')
	.example(
		'$0 -p BNBBTC -a 1 -b 0.002 -s 0.001 -t 0.003',
		'Place a buy order for 1 BNB @ 0.002 BTC. Once filled, place a stop-limit sell @ 0.001 BTC. If a price of 0.003 BTC is reached, cancel stop-limit order and place a limit sell @ 0.003 BTC.'
	)
	// '-p <tradingPair>'
	.demand('pair')
	.alias('p', 'pair')
	.describe('p', 'Set trading pair eg. BNBBTC')
	// '-a <amount>'
	.string('a')
	.alias('a', 'amount')
	.describe('a', 'Set amount to buy/sell')
	// '-q <amount in quote coin>'
	.string('q')
	.alias('q', 'amountquote')
	.describe('q', 'Set amount to buy in quote coin (alternative to -a for limit buy orders only)')
	// '-b <buyPrice>'
	.string('b')
	.alias('b', 'buy')
	.alias('b', 'e')
	.alias('b', 'entry')
	.describe('b', 'Set buy price (0 for market buy)')
	// '-B <buyLimitPrice>'
	.string('B')
	.alias('B', 'buy-limit')
	.alias('B', 'E')
	.alias('B', 'entry-limit')
	.describe('B', 'Set buy stop-limit order limit price (if different from buy price)')
	// '-s <stopPrice>'
	.string('s')
	.alias('s', 'stop')
	.describe('s', 'Set stop-limit order stop price')
	// '-l <limitPrice>'
	.string('l')
	.alias('l', 'limit')
	.describe('l', 'Set sell stop-limit order limit price (if different from stop price)')
	// '-t <targetPrice>'
	.string('t')
	.alias('t', 'target')
	.describe('t', 'Set target limit order sell price')
	// '--non-bnb-fees'
	.boolean('F')
	.alias('F', 'non-bnb-fees')
	.describe('F', 'Calculate stop/target sell amounts assuming not paying fees using BNB')
	.default('F', false);

let {
	p: pair,
	a: amount,
	q: quoteAmount,
	b: buyPrice,
	B: buyLimitPrice,
	s: stopPrice,
	l: limitPrice,
	t: targetPrice
} = argv;

if (buyPrice === '') {
	buyPrice = '0';
}

if (quoteAmount && buyPrice && buyPrice != 0) {
	amount = BigNumber(quoteAmount).dividedBy(buyPrice);
	console.log(`Calculated buy amount ${amount.toFixed()}`);
}

if (!amount) {
	console.error('You must specify amount with -a or via -q');
	process.exit(1);
}

const { F: nonBnbFees } = argv;

pair = pair.toUpperCase();

// TODO: Note that for all authenticated endpoints, you can pass an extra parameter useServerTime
// TODO: set to true in order to fetch the server time before making the request.

const binance_client = Binance({
	apiKey: process.env.APIKEY,
	apiSecret: process.env.APISECRET
	// getTime: xxx // time generator function, optional, defaults to () => Date.now()
});

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

var closeUserWebsocket, closeTradesWebSocket;

async function main() {
	closeUserWebsocket = await binance_client.ws.user((data) => {
		const { i: orderId } = data;

		if (orderId === buyOrderId) {
			checkOrderFilled(data, () => {
				const { N: commissionAsset } = data;
				buyOrderId = 0;
				fsm.buyOrderFilled();
			});
		} else if (orderId === stopOrderId) {
			checkOrderFilled(data, () => {
				throw new ExecutionComplete(`Stop hit`);
			});
		} else if (orderId === targetOrderId) {
			checkOrderFilled(data, () => {
				throw new ExecutionComplete(`Target hit`);
			});
		}
	});

	var exchangeInfoData;
	try {
		exchangeInfoData = await binance_client.exchangeInfo();
	} catch (e) {
		console.error('Error could not pull exchange info');
		console.error(e);
		throw new Error('Error could not pull exchange info');
	}

	const symbolData = exchangeInfoData.symbols.find((ei) => ei.symbol === pair);
	if (!symbolData) {
		throw new Error(`Could not pull exchange info for ${pair}`);
	}

	const { filters } = symbolData;
	const { stepSize, minQty } = filters.find((eis) => eis.filterType === 'LOT_SIZE');
	const { tickSize, minPrice } = filters.find((eis) => eis.filterType === 'PRICE_FILTER');
	const { minNotional } = filters.find((eis) => eis.filterType === 'MIN_NOTIONAL');

	function munge_and_check_quantity(name, volume) {
		volume = BigNumber(roundStep(BigNumber(volume), stepSize));
		if (volume.isLessThan(minQty)) {
			throw new Error(`${name} ${volume} does not meet minimum order amount ${minQty}.`);
		}
		return volume;
	}

	function munge_and_check_price(name, price) {
		price = BigNumber(price);
		if (price.isZero()) return price; // don't munge zero, special case for market buys
		price = BigNumber(roundTicks(price, tickSize));
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

	amount = munge_and_check_quantity('Amount', amount);

	if (buyPrice && buyPrice !== 0) {
		buyPrice = munge_and_check_price('Buy price', buyPrice);
		check_notional('Buy order', buyPrice, amount);

		if (buyLimitPrice) {
			buyLimitPrice = munge_and_check_price('Buy limit price', buyLimitPrice);
		}
	}

	if (stopPrice) {
		stopPrice = munge_and_check_price('Stop price', stopPrice);

		if (limitPrice) {
			limitPrice = munge_and_check_price('Limit price', limitPrice);
			check_notional('Stop order', limitPrice, amount);
		} else {
			check_notional('Stop order', stopPrice, amount);
		}
	}

	if (targetPrice) {
		targetPrice = munge_and_check_price('Target price', targetPrice);
		check_notional('Target order', targetPrice, amount);
	}

	const NON_BNB_TRADING_FEE = BigNumber('0.001');

	const calculateSellAmount = function(commissionAsset, sellAmount) {
		// Adjust sell amount if BNB not used for trading fee
		return commissionAsset === 'BNB' && !nonBnbFees
			? sellAmount
			: sellAmount.times(BigNumber(1).minus(NON_BNB_TRADING_FEE));
	};

	let stopOrderId = 0;
	let targetOrderId = 0;

	const sellComplete = function(error, response) {
		if (error) {
			throw new Error('Sell error', error.body);
		}

		console.log('Sell response', response);
		console.log(`order id: ${response.orderId}`);

		if (!(stopPrice && targetPrice)) {
			throw new ExecutionComplete();
		}

		if (response.type === 'STOP_LOSS_LIMIT') {
			send_message(`${pair} stopped out`);
			stopOrderId = response.orderId;
		} else if (response.type === 'LIMIT') {
			send_message(`${pair} hit target price`);
			targetOrderId = response.orderId;
		}
	};

	async function placeStopOrder() {
		try {
			let args = {
				side: 'SELL',
				symbol: pair,
				type: 'STOP_LOSS_LIMIT',
				quantity: amount.toFixed(),
				price: (limitPrice || stopPrice).toFixed(), // TODO: what's this limitPrice bit?
				stopPrice: stopPrice.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			console.log(`Creating STOP_LOSS_LIMIT SELL ORDER`);
			console.log(args);
			let response = await binance_client.order(args);
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
				symbol: pair,
				type: 'LIMIT',
				quantity: amount.toFixed(),
				price: targetPrice.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			console.log(`Creating LIMIT SELL ORDER`);
			console.log(args);
			let response = await binance_client.order(args);
			console.log('Buy response', response);
			console.log(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `error placing order: ${error.body}`, error);
		}
	}

	const placeSellOrder = function() {
		if (stopPrice) {
			placeStopOrder();
		} else if (targetPrice) {
			placeTargetOrder();
		} else {
			throw new ExecutionComplete();
		}
	};

	async function create_market_buy_order() {
		try {
			let args = {
				side: 'BUY',
				symbol: pair,
				type: 'MARKET',
				quantity: amount.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			console.log(`Creating MARKET BUY ORDER`);
			// console.log(args);
			let response = await binance_client.order(args);
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
				symbol: pair,
				type: 'LIMIT',
				quantity: amount.toFixed(),
				price: buyPrice.toFixed()
				// TODO: more args here, server time and use FULL response body
			};
			console.log(`Creating LIMIT BUY ORDER`);
			console.log(args);
			let response = await binance_client.order(args);
			fsm.buyOrderCreated();
			console.log('Buy response', response);
			console.log(`order id: ${response.orderId}`);
			return response.orderId;
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	}

	var buyOrderId = 0;
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

	if (typeof buyPrice !== 'undefined') {
		if (buyPrice.isZero()) {
			buyOrderId = await create_market_buy_order();
		} else {
			buyOrderId = await create_limit_buy_order();
		}
	}

	// TODO: I guess it would be good to check how much the balance is on the exchange
	// against 'amount' if there is no buy stage

	if (fsm.is('initialising')) {
		throw new Error(`Unable to determine intial state`);
	}

	// console.log(`BuyPrice: ${buyPrice}, isZero(): ${buyPrice.isZero()}`);
	// if (typeof buyPrice !== 'undefined') {
	// 	if (buyPrice.isZero()) {
	// 		buyOrderId = await create_market_buy_order();
	// TODO: move this code
	// 	} else if (buyPrice.isGreaterThan(0)) {
	// 		old_binance.prices(pair, (error, ticker) => {
	// 			const currentPrice = ticker[pair];
	// 			console.log(`${pair} price: ${currentPrice}`);

	// 			if (buyPrice.isGreaterThan(currentPrice)) {
	// 				isStopEntry = true;
	// 				old_binance.buy(
	// 					pair,
	// 					amount.toFixed(),
	// 					(buyLimitPrice || buyPrice).toFixed(),
	// 					{ stopPrice: buyPrice.toFixed(), type: 'STOP_LOSS_LIMIT', newOrderRespType: 'FULL' },
	// 					buyComplete
	// 				);
	// 			} else {
	// 				isLimitEntry = true;
	// 				console.error('needs implementing');
	// 				throw new Error('backtrace me');
	// 			}
	// 		});
	// 	}
	// } else {
	// 	placeSellOrder();
	// }

	let isCancelling = false;

	// TODO: we don't always need this - only if we have cancel/stop/target orders the need monitoring
	closeTradesWebSocket = await binance_client.ws.aggTrades([ pair ], async function(trade) {
		var { s: symbol, p: price } = trade;
		price = BigNumber(price);

		if (buyOrderId) {
			// console.log(`${symbol} trade update. price: ${price} buy: ${buyPrice}`);
		} else if (stopOrderId || targetOrderId) {
			// console.log(`${symbol} trade update. price: ${price} stop: ${stopPrice} target: ${targetPrice}`);
			if (stopOrderId && !targetOrderId && price.isGreaterThanOrEqualTo(targetPrice) && !isCancelling) {
				console.log(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
				isCancelling = true;
				try {
					await binance_client.cancelOrder({ symbol, orderId: stopOrderId });
					isCancelling = false;
				} catch (error) {
					console.error(`${symbol} cancel error:`, error.body);
					return;
				}
				stopOrderId = 0;
				console.log(`${symbol} cancel response:`, response);
				placeTargetOrder();
			} else if (targetOrderId && !stopOrderId && price.isLessThanOrEqualTo(stopPrice) && !isCancelling) {
				isCancelling = true;
				try {
					await binance_client.cancelOrder({ symbol, orderId: targetOrderId });
					isCancelling = false;
				} catch (error) {
					console.error(`${symbol} cancel error:`, error.body);
					return;
				}
				targetOrderId = 0;
				console.log(`${symbol} cancel response:`, response);
				placeStopOrder();
			}
		}
	});

	await sleep(2000);
	console.log('hey - trades active');

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

main()
	.then(() => {
		console.log('main loop complete');
	})
	.catch((error) => {
		console.log(`Error in main loop: ${error}`);
		console.log(error);
		console.log(`Error in main loop: ${error.stack}`);
		send_message(`${pair}: Error in main loop: ${error}`);
		soft_exit();
	});

function dump_keepalive() {
	let handles = process._getActiveHandles();
	console.log('Handles:');
	console.log(handles.filter((handle) => handle._isStdio != true));
	let requests = process._getActiveRequests();
	console.log('Requests:');
	console.log(requests);
	// setTimeout(dump_keepalive, 10000);
}

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code) {
	shutdown_streams();
	if (exit_code) process.exitCode = exit_code;
	// setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

function shutdown_streams() {
	if (closeUserWebsocket) closeUserWebsocket();
	if (closeTradesWebSocket) closeTradesWebSocket();
}

process.on('exit', () => {
	shutdown_streams();
});
