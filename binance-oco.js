#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require('dotenv').config();

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
	.demand('amount')
	.string('a')
	.alias('a', 'amount')
	.describe('a', 'Set amount to buy/sell')
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
	b: buyPrice,
	B: buyLimitPrice,
	s: stopPrice,
	l: limitPrice,
	t: targetPrice,
	c: cancelPrice,
	S: scaleOutAmount
} = argv;

const { F: nonBnbFees } = argv;

pair = pair.toUpperCase();

const Binance = require('node-binance-api');
const BigNumber = require('bignumber.js');

const binance = new Binance().options(
	{
		APIKEY: process.env.APIKEY,
		APISECRET: process.env.APISECRET,
		useServerTime: true,
		reconnect: true
	},
	() => {
		binance.exchangeInfo((exchangeInfoError, exchangeInfoData) => {
			if (exchangeInfoError) {
				console.error('Could not pull exchange info', exchangeInfoError.body);
				process.exit(1);
			}

			const symbolData = exchangeInfoData.symbols.find((ei) => ei.symbol === pair);
			if (!symbolData) {
				console.error(`Could not pull exchange info for ${pair}`);
				process.exit(1);
			}

			const { filters } = symbolData;
			const { stepSize, minQty } = filters.find((eis) => eis.filterType === 'LOT_SIZE');
			const { tickSize, minPrice } = filters.find((eis) => eis.filterType === 'PRICE_FILTER');
			const { minNotional } = filters.find((eis) => eis.filterType === 'MIN_NOTIONAL');

			amount = BigNumber(binance.roundStep(BigNumber(amount), stepSize));

			if (amount.isLessThan(minQty)) {
				console.error(`Amount ${amount} does not meet minimum order amount ${minQty}.`);
				process.exit(1);
			}

			if (scaleOutAmount) {
				scaleOutAmount = BigNumber(binance.roundStep(BigNumber(scaleOutAmount), stepSize));

				if (scaleOutAmount.isLessThan(minQty)) {
					console.error(`Scale out amount ${scaleOutAmount} does not meet minimum order amount ${minQty}.`);
					process.exit(1);
				}
			}

			if (buyPrice) {
				buyPrice = BigNumber(binance.roundTicks(BigNumber(buyPrice), tickSize));

				if (buyLimitPrice) {
					buyLimitPrice = BigNumber(binance.roundTicks(BigNumber(buyLimitPrice), tickSize));
				}

				if (buyPrice.isLessThan(minPrice)) {
					console.error(`Buy price ${buyPrice} does not meet minimum order price ${minPrice}.`);
					process.exit(1);
				}

				if (buyPrice.times(amount).isLessThan(minNotional)) {
					console.error(`Buy order does not meet minimum order value ${minNotional}.`);
					process.exit(1);
				}
			}

			let stopSellAmount = amount;

			if (stopPrice) {
				stopPrice = BigNumber(binance.roundTicks(BigNumber(stopPrice), tickSize));

				if (limitPrice) {
					limitPrice = BigNumber(binance.roundTicks(BigNumber(limitPrice), tickSize));

					if (limitPrice.isLessThan(minPrice)) {
						console.error(`Limit price ${limitPrice} does not meet minimum order price ${minPrice}.`);
						process.exit(1);
					}

					if (limitPrice.times(stopSellAmount).isLessThan(minNotional)) {
						console.error(`Stop order does not meet minimum order value ${minNotional}.`);
						process.exit(1);
					}
				} else {
					if (stopPrice.isLessThan(minPrice)) {
						console.error(`Stop price ${stopPrice} does not meet minimum order price ${minPrice}.`);
						process.exit(1);
					}

					if (stopPrice.times(stopSellAmount).isLessThan(minNotional)) {
						console.error(`Stop order does not meet minimum order value ${minNotional}.`);
						process.exit(1);
					}
				}
			}

			let targetSellAmount = scaleOutAmount || amount;

			if (targetPrice) {
				targetPrice = BigNumber(binance.roundTicks(BigNumber(targetPrice), tickSize));

				console.log(`minPrice: ${JSON.stringify(minPrice)}, ${typeof minPrice}`);
				if (targetPrice.isLessThan(minPrice)) {
					console.error(`Target price ${targetPrice} does not meet minimum order price ${minPrice}.`);
					process.exit(1);
				}

				if (targetPrice.times(targetSellAmount).isLessThan(minNotional)) {
					console.error(`Target order does not meet minimum order value ${minNotional}.`);
					process.exit(1);
				}

				const remainingAmount = amount.minus(targetSellAmount);
				if (!remainingAmount.isZero() && stopPrice) {
					if (remainingAmount.isLessThan(minQty)) {
						console.error(
							`Stop amount after scale out (${remainingAmount}) will not meet minimum order amount ${minQty}.`
						);
						process.exit(1);
					}

					if (stopPrice.times(remainingAmount).isLessThan(minNotional)) {
						console.error(`Stop order after scale out will not meet minimum order value ${minNotional}.`);
						process.exit(1);
					}
				}
			}

			if (cancelPrice) {
				cancelPrice = BigNumber(binance.roundTicks(BigNumber(cancelPrice), tickSize));
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
					console.error('Sell error', error.body);
					process.exit(1);
				}

				console.log('Sell response', response);
				console.log(`order id: ${response.orderId}`);

				if (!(stopPrice && targetPrice)) {
					process.exit();
				}

				if (response.type === 'STOP_LOSS_LIMIT') {
					stopOrderId = response.orderId;
				} else if (response.type === 'LIMIT') {
					targetOrderId = response.orderId;
				}
			};

			const placeStopOrder = function() {
				binance.sell(
					pair,
					stopSellAmount.toFixed(),
					(limitPrice || stopPrice).toFixed(),
					{ stopPrice: stopPrice.toFixed(), type: 'STOP_LOSS_LIMIT', newOrderRespType: 'FULL' },
					sellComplete
				);
			};

			const placeTargetOrder = function() {
				binance.sell(
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
					process.exit();
				}
			};

			let buyOrderId = 0;

			const buyComplete = function(error, response) {
				if (error) {
					console.error('Buy error', error.body);
					process.exit(1);
				}

				console.log('Buy response', response);
				console.log(`order id: ${response.orderId}`);

				if (response.status === 'FILLED') {
					calculateStopAndTargetAmounts(response.fills[0].commissionAsset);
					placeSellOrder();
				} else {
					buyOrderId = response.orderId;
				}
			};

			let isLimitEntry = false;
			let isStopEntry = false;

			if (buyPrice && buyPrice.isZero()) {
				binance.marketBuy(pair, amount.toFixed(), { type: 'MARKET', newOrderRespType: 'FULL' }, buyComplete);
			} else if (buyPrice && buyPrice.isGreaterThan(0)) {
				binance.prices(pair, (error, ticker) => {
					const currentPrice = ticker[pair];
					console.log(`${pair} price: ${currentPrice}`);

					if (buyPrice.isGreaterThan(currentPrice)) {
						isStopEntry = true;
						binance.buy(
							pair,
							amount.toFixed(),
							(buyLimitPrice || buyPrice).toFixed(),
							{ stopPrice: buyPrice.toFixed(), type: 'STOP_LOSS_LIMIT', newOrderRespType: 'FULL' },
							buyComplete
						);
					} else {
						isLimitEntry = true;
						binance.buy(
							pair,
							amount.toFixed(),
							buyPrice.toFixed(),
							{ type: 'LIMIT', newOrderRespType: 'FULL' },
							buyComplete
						);
					}
				});
			} else {
				placeSellOrder();
			}

			let isCancelling = false;

			binance.websockets.trades([ pair ], (trades) => {
				const { s: symbol, p: price } = trades;
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
							binance.cancel(symbol, buyOrderId, (error, response) => {
								isCancelling = false;
								if (error) {
									console.error(`${symbol} cancel error:`, error.body);
									return;
								}

								console.log(`${symbol} cancel response:`, response);
								process.exit(0);
							});
						}
					}
				} else if (stopOrderId || targetOrderId) {
					console.log(`${symbol} trade update. price: ${price} stop: ${stopPrice} target: ${targetPrice}`);
					if (stopOrderId && !targetOrderId && price.isGreaterThanOrEqualTo(targetPrice) && !isCancelling) {
						console.log(`Event: price >= targetPrice: cancelling stop and placeTargetOrder()`);
						isCancelling = true;
						binance.cancel(symbol, stopOrderId, (error, response) => {
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
						binance.cancel(symbol, targetOrderId, (error, response) => {
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

			const checkOrderFilled = function(data, orderFilled) {
				const { s: symbol, p: price, q: quantity, S: side, o: orderType, i: orderId, X: orderStatus } = data;

				console.log(`${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`);
				console.log(`..price: ${price}, quantity: ${quantity}`);

				if (orderStatus === 'NEW' || orderStatus === 'PARTIALLY_FILLED') {
					return;
				}

				if (orderStatus !== 'FILLED') {
					console.log(`Order ${orderStatus}. Reason: ${data.r}`);
					process.exit(1);
				}

				orderFilled(data);
			};

			binance.websockets.userData(
				() => {},
				(data) => {
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
							process.exit();
						});
					} else if (orderId === targetOrderId) {
						checkOrderFilled(data, () => {
							process.exit();
						});
					}
				}
			);
		});
	}
);

process.on('exit', () => {
	const endpoints = binance.websockets.subscriptions();
	binance.websockets.terminate(Object.entries(endpoints));
});
