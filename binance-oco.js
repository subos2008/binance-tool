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
const OldBinance = require('node-binance-api');
const BigNumber = require('bignumber.js');
const send_message = require('./telegram.js');

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
	// '-c <cancelPrice>'
	.string('c')
	.alias('c', 'cancel')
	.describe('c', 'Set price at which to cancel buy order')
	// '-S <scaleOutAmount>'
	.string('S')
	.alias('S', 'scaleOutAmount')
	.describe('S', 'Set amount to sell (scale out) at target price (if different from amount)')
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
	t: targetPrice,
	c: cancelPrice,
	S: scaleOutAmount
} = argv;

if (buyPrice === '') {
	buyPrice = '0';
}

console.log(buyPrice);
console.log(typeof buyPrice);

if (quoteAmount && buyPrice) {
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

const old_binance = new OldBinance().options({
	APIKEY: process.env.APIKEY,
	APISECRET: process.env.APISECRET,
	useServerTime: true,
	reconnect: true
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
				calculateStopAndTargetAmounts(commissionAsset);
				placeSellOrder();
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
		volume = BigNumber(old_binance.roundStep(BigNumber(volume), stepSize));
		if (volume.isLessThan(minQty)) {
			throw new Error(`${name} ${volume} does not meet minimum order amount ${minQty}.`);
		}
		return volume;
	}

	function munge_and_check_price(name, price) {
		price = BigNumber(old_binance.roundTicks(BigNumber(price), tickSize));
		if (price.isZero) {
			price = BigNumber(minPrice);
		}
		if (price.isLessThan(minPrice)) {
			throw new Error(`${name} ${price} does not meet minimum order price ${minPrice}.`);
		}
		return price;
	}

	function check_notional(name, price, volume) {
		if (price.times(volume).isLessThan(minNotional)) {
			throw new Error(`${name} does not meet minimum order value ${minNotional}.`);
		}
	}

	amount = munge_and_check_quantity('Amount', amount);

	if (scaleOutAmount) {
		scaleOutAmount = munge_and_check_quantity('Scale out amount', scaleOutAmount);
	}

	if (buyPrice) {
		buyPrice = munge_and_check_price('Buy price', buyPrice);
		check_notional('Buy order', buyPrice, amount);

		if (buyLimitPrice) {
			buyLimitPrice = munge_and_check_price('Buy limit price', buyLimitPrice);
		}
	}

	let stopSellAmount = amount;

	if (stopPrice) {
		stopPrice = munge_and_check_price('Stop price', stopPrice);

		if (limitPrice) {
			limitPrice = munge_and_check_price('Limit price', limitPrice);
			check_notional('Stop order', limitPrice, stopSellAmount);
		} else {
			check_notional('Stop order', stopPrice, stopSellAmount);
		}
	}

	let targetSellAmount = scaleOutAmount || amount;

	if (targetPrice) {
		targetPrice = munge_and_check_price('Target price', targetPrice);
		check_notional('Target order', targetPrice, targetSellAmount);

		const remainingAmount = amount.minus(targetSellAmount);
		if (!remainingAmount.isZero() && stopPrice) {
			munge_and_check_quantity(`Stop amount after scale out (${remainingAmount})`, remainingAmount);
			check_notional('Stop order after scale out', stopPrice, remainingAmount);
		}
	}

	if (cancelPrice) {
		cancelPrice = munge_and_check_price('cancelPrice', cancelPrice);
	}

	const NON_BNB_TRADING_FEE = BigNumber('0.001');

	const calculateSellAmount = function(commissionAsset, sellAmount) {
		// Adjust sell amount if BNB not used for trading fee
		return commissionAsset === 'BNB' && !nonBnbFees
			? sellAmount
			: sellAmount.times(BigNumber(1).minus(NON_BNB_TRADING_FEE));
	};

	const calculateStopAndTargetAmounts = function(commissionAsset) {
		stopSellAmount = calculateSellAmount(commissionAsset, stopSellAmount);
		targetSellAmount = calculateSellAmount(commissionAsset, targetSellAmount);
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

	const placeStopOrder = function() {
		old_binance.sell(
			pair,
			stopSellAmount.toFixed(),
			(limitPrice || stopPrice).toFixed(),
			{ stopPrice: stopPrice.toFixed(), type: 'STOP_LOSS_LIMIT', newOrderRespType: 'FULL' },
			sellComplete
		);
	};

	const placeTargetOrder = function() {
		old_binance.sell(
			pair,
			targetSellAmount.toFixed(),
			targetPrice.toFixed(),
			{ type: 'LIMIT', newOrderRespType: 'FULL' },
			sellComplete
		);
		if (stopPrice && !targetSellAmount.isEqualTo(stopSellAmount)) {
			stopSellAmount = stopSellAmount.minus(targetSellAmount);
			placeStopOrder();
		}
	};

	const placeSellOrder = function() {
		if (stopPrice) {
			placeStopOrder();
		} else if (targetPrice) {
			placeTargetOrder();
		} else {
			throw new ExecutionComplete();
		}
	};

	let buyOrderId = 0;

	const buyComplete = function(response) {
		console.log('Buy response', response);
		console.log(`order id: ${response.orderId}`);

		if (response.status === 'FILLED') {
			send_message(`Immediate fill on ${pair} buy order`);
			calculateStopAndTargetAmounts(response.fills[0].commissionAsset);
			placeSellOrder();
		} else {
			buyOrderId = response.orderId;
		}
	};

	let isLimitEntry = false;
	let isStopEntry = false;

	console.log(`BuyPrice: ${buyPrice}, ${buyPrice.isZero}`);
	if (typeof buyPrice !== 'undefined' && buyPrice.isZero) {
		try {
			let response = await binance_client.order({
				side: 'BUY',
				symbol: pair,
				type: 'MARKET',
				quantity: amount.toFixed()
			});
			console.log(response);
			buyComplete(response);
		} catch (error) {
			async_error_handler(console, `Buy error: ${error.body}`, error);
		}
	} else if (buyPrice && buyPrice.isGreaterThan(0)) {
		old_binance.prices(pair, (error, ticker) => {
			const currentPrice = ticker[pair];
			console.log(`${pair} price: ${currentPrice}`);

			if (buyPrice.isGreaterThan(currentPrice)) {
				isStopEntry = true;
				old_binance.buy(
					pair,
					amount.toFixed(),
					(buyLimitPrice || buyPrice).toFixed(),
					{ stopPrice: buyPrice.toFixed(), type: 'STOP_LOSS_LIMIT', newOrderRespType: 'FULL' },
					buyComplete
				);
			} else {
				isLimitEntry = true;
				console.error('needs implementing');
				throw new Error('backtrace me');

				// try {
				// 	let response = await binance_client.order({
				// 		side: 'BUY',
				// 		symbol: pair,
				// 		type: 'LIMIT',
				// 		price: buyPrice.toFixed(),
				// 		newOrderRespType: 'FULL',
				// 		timeInForce: 'GTC',
				// 		quantity: amount.toFixed()
				// 	});
				// 	console.log(response);
				// 	buyComplete(response);
				// } catch (error) {
				// 	async_error_handler(console, `Buy error: ${error.body}`, error);
				// }
				// old code
				// old_binance.buy(
				// 	pair,
				// 	amount.toFixed(),
				// 	buyPrice.toFixed(),
				// 	{ type: 'LIMIT', newOrderRespType: 'FULL' },
				// 	buyComplete
				// );
			}
		});
	} else {
		placeSellOrder();
	}

	let isCancelling = false;

	// TODO: rename trades to trade
	closeTradesWebSocket = await binance_client.ws.trades([ 'ETHBTC', 'BNBBTC' ], (trades) => {
		var { s: symbol, p: price } = trades;
		price = BigNumber(price);

		if (buyOrderId) {
			if (!cancelPrice) {
				// console.log(`${symbol} trade update. price: ${price} buy: ${buyPrice}`);
			} else {
				// console.log(`${symbol} trade update. price: ${price} buy: ${buyPrice} cancel: ${cancelPrice}`);

				if (
					((isStopEntry && price.isLessThanOrEqualTo(cancelPrice)) ||
						(isLimitEntry && price.isGreaterThanOrEqualTo(cancelPrice))) &&
					!isCancelling
				) {
					isCancelling = true;
					old_binance.cancel(symbol, buyOrderId, (error, response) => {
						isCancelling = false;
						if (error) {
							console.error(`${symbol} cancel error:`, error.body);
							return;
						}

						console.log(`${symbol} cancel response:`, response);
						throw new ExecutionComplete();
					});
				}
			}
		} else if (stopOrderId || targetOrderId) {
			// console.log(`${symbol} trade update. price: ${price} stop: ${stopPrice} target: ${targetPrice}`);
			if (stopOrderId && !targetOrderId && price.isGreaterThanOrEqualTo(targetPrice) && !isCancelling) {
				console.log(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
				isCancelling = true;
				old_binance.cancel(symbol, stopOrderId, (error, response) => {
					isCancelling = false;
					if (error) {
						console.error(`${symbol} cancel error:`, error.body);
						return;
					}

					stopOrderId = 0;
					console.log(`${symbol} cancel response:`, response);
					placeTargetOrder();
				});
			} else if (targetOrderId && !stopOrderId && price.isLessThanOrEqualTo(stopPrice) && !isCancelling) {
				isCancelling = true;
				old_binance.cancel(symbol, targetOrderId, (error, response) => {
					isCancelling = false;
					if (error) {
						console.error(`${symbol} cancel error:`, error.body);
						return;
					}

					targetOrderId = 0;
					console.log(`${symbol} cancel response:`, response);
					if (!targetSellAmount.isEqualTo(stopSellAmount)) {
						stopSellAmount = stopSellAmount.plus(targetSellAmount);
					}
					placeStopOrder();
				});
			}
		}
	});

	await sleep(2000);
	console.log('hey - trades active');
	endpoints = old_binance.websockets.subscriptions();
	console.log(endpoints);

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
		console.log(`Error in main loop: ${error.stack}`);
		send_message(`${pair}: Error in main loop: ${error}`);
		soft_exit();
	});

const exchangeInfoData = binance_client;

function dump_keepalive() {
	console.log(process._getActiveHandles());
	console.log(process._getActiveRequests());
	let endpoints = old_binance.websockets.subscriptions();
	console.log(endpoints);
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
