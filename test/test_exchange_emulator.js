'use strict';
const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Logger = require('../lib/faux_logger');
const { NotImplementedError, InsufficientBalanceError } = require('../lib/errors');
const async_error_handler = require('../lib/async_error_handler');
const utils = require('../lib/utils');
const fs = require('fs');

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

// Tests needed:
// .exchangeInfo
// .order(args)
// .ws.aggTrades([ pair ], (trade) => {
// .ws.user((data) => {

const default_base_currency = 'ETH';
const default_quote_currency = 'BTC';
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

describe('ExchangeEmulator', function() {
	function setup(ee_config = {}) {
		if (ee_config.starting_quote_balance || ee_config.starting_base_balance) {
			ee_config.starting_balances = {};
		}
		if (ee_config.starting_quote_balance)
			ee_config.starting_balances[default_quote_currency] = ee_config.starting_quote_balance;
		if (ee_config.starting_base_balance)
			ee_config.starting_balances[default_base_currency] = ee_config.starting_base_balance;
		ee_config = Object.assign(
			{
				logger: null_logger,
				exchange_info
			},
			ee_config
		);
		return new ExchangeEmulator(ee_config);
	}

	describe('constructor', function() {
		it('sets balance_not_in_orders(default_quote_currency) to starting_quote_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			expect(ee.balance_not_in_orders(default_quote_currency).isEqualTo(starting_quote_balance)).to.equal(true);
		});
		it('sets balance_not_in_orders(default_base_currency) to starting_base_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = setup({ logger, starting_quote_balance, starting_base_balance });
			expect(ee.balance_not_in_orders(default_base_currency).isEqualTo(starting_base_balance)).to.equal(true);
		});
		it('sets balance_in_orders(default_quote_currency) to zero', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			expect(ee.balance_in_orders(default_quote_currency).isEqualTo(0)).to.equal(true);
		});
	});

	describe('add_market_buy_order', function() {
		it('raises an async InsufficientBalanceError if balance_not_in_orders(default_quote_currency) is insufficient');
		it('decreases balance_not_in_orders(default_quote_currency)');
		it('increases balance_in_orders(default_quote_currency)');
		it('adds a limit_buy_order to open_orders');
		it('executes the order when the buy price is hit');
	});

	describe('add_limit_buy_order', function() {
		it.skip(
			'raises an async InsufficientBalanceError if balance_not_in_orders(default_quote_currency) is insufficient',
			async function() {
				const starting_quote_balance = BigNumber(1);
				const ee = setup({ logger: null_logger, starting_quote_balance });
				try {
					await ee.add_limit_buy_order({
						base_volume: BigNumber(2),
						limit_price: BigNumber('1'),
						pair: default_pair
					});
				} catch (e) {
					expect(e).to.be.instanceOf(Error);
					expect(e).to.have.property('original_name', 'InsufficientBalanceError');
					return;
				}
				expect.fail('should not get here: expected call to throw');
			}
		);

		it('decreases balance_not_in_orders(default_quote_currency)', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			await ee.add_limit_buy_order({ base_volume: BigNumber(1), limit_price: BigNumber(1), pair: default_pair });
			expect(ee.balance_not_in_orders(default_quote_currency).isEqualTo(0)).to.equal(true);
		});
		it('increases balance_in_orders(default_quote_currency)', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_buy_order({ base_volume, limit_price, pair: default_pair });
			const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: limit_price });
			expect(ee.balance_in_orders(default_quote_currency).isEqualTo(quote_volume)).to.equal(true);
		});
		it('adds a limit_buy_order to open_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_buy_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('BUY');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
		});
		it('executes the order when the buy price is hit');
	});

	describe('add_limit_sell_order', function() {
		it.skip('fails if balance_not_in_orders(default_base_currency) is insufficient', async function() {
			expect(false).to.equal(true);
		});
		it('decreases balance_not_in_orders(default_base_currency)', async function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = setup({ logger, starting_quote_balance, starting_base_balance });
			await ee.add_limit_sell_order({ base_volume: BigNumber(1), limit_price: BigNumber(1), pair: default_pair });
			expect(ee.balance_not_in_orders(default_base_currency)).to.be.bignumber.equal(3);
		});
		it('increases balance_in_orders(default_base_currency)', async function() {
			//should fail
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = setup({ logger, starting_quote_balance, starting_base_balance });
			const base_volume = BigNumber(2);
			const limit_price = BigNumber(1);
			await ee.add_limit_sell_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.balance_in_orders(default_base_currency)).to.be.bignumber.equal(base_volume);
		});
		it('adds a limit_sell_order to open_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = setup({ logger, starting_quote_balance, starting_base_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_sell_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
		});
	});
	describe('cancel_all_open_orders', function() {
		it('correctly cancels both buy and sell orders', async function() {
			const starting_quote_balance = BigNumber(1.5);
			const starting_base_balance = BigNumber(4);
			const ee = setup({ logger, starting_quote_balance, starting_base_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_sell_order({ base_volume, limit_price, pair: default_pair });
			await ee.add_limit_buy_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(2);
			await ee.cancel_all_open_orders();
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.balance_in_orders(default_base_currency)).to.be.bignumber.equal(0);
			expect(ee.balance_not_in_orders(default_base_currency)).to.be.bignumber.equal(starting_base_balance);
			expect(ee.balance_in_orders(default_quote_currency)).to.be.bignumber.equal(0);
			expect(ee.balance_not_in_orders(default_quote_currency)).to.be.bignumber.equal(starting_quote_balance);
		});
	});

	describe('BNB and trading fees', function() {
		it('correctly handles trading fee deductions');
		it('understands if you dont have enough BNB for a trade and ...');
		it('deducts from BNB balance if set to do so');
		it('deducts from ??? if not set to use BNB');
	});

	describe('check_for_completed_limit_orders', function() {
		it.skip('checks for the correct symbol. ISSUE');
		it('executes a limit buy order', async function() {
			const starting_quote_balance = BigNumber(3);
			const starting_base_balance = BigNumber(0);
			const limit_price = BigNumber(1);
			const ee = setup({ logger: null_logger, starting_quote_balance, starting_base_balance });
			await ee.set_current_price({ symbol: default_pair, price: limit_price.plus(1) }); // start higher than limit price
			await ee.add_limit_buy_order({ base_volume: BigNumber(3), limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			await ee.set_current_price({ symbol: default_pair, price: limit_price });
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.balance_not_in_orders(default_base_currency)).to.be.bignumber.equal(3);
			expect(ee.balance_not_in_orders(default_quote_currency)).to.be.bignumber.equal(0);
			// TODO: fees
		});
		it('executes a limit sell order', async function() {
			const starting_quote_balance = BigNumber(0);
			const starting_base_balance = BigNumber(3);
			const limit_price = BigNumber(1);
			const ee = setup({ logger: null_logger, starting_quote_balance, starting_base_balance });
			await ee.set_current_price({ symbol: default_pair, price: limit_price.minus(1) }); // start lower than limit price
			await ee.add_limit_sell_order({ base_volume: BigNumber(3), limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			await ee.set_current_price({ symbol: default_pair, price: limit_price });
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.balance_not_in_orders(default_base_currency)).to.be.bignumber.equal(0);
			expect(ee.balance_not_in_orders(default_quote_currency)).to.be.bignumber.equal(3);
			// TODO: fees
		});
		// TODO: I guess actually the test here is that Binance refuses to take limit orders that
		// TODO: would execute immediately
		it('doesnt execute a limit buy if the starting price was lower...some shit like that');
	});
	describe('multi coin balances', function() {
		it('takes multicoin balances in constructor and returns them', async function() {
			const ee = setup({
				logger: null_logger,
				starting_balances: { BTC: BigNumber('101'), ETH: BigNumber('202') }
			});
			let balances = (await ee.accountInfo()).balances;
			expect(balances).to.be.an('array').that.has.lengthOf(2);
			expect(balances).to.deep.include({ asset: 'BTC', free: '101', locked: '0' });
			expect(balances).to.deep.include({ asset: 'ETH', free: '202', locked: '0' });
		});
		it('locks balances of open trades');
	});
	describe('binance-api-node API', function() {
		async function do_limit_buy_order({ ee, price, amount, symbol } = {}) {
			try {
				return await ee.order({
					side: 'BUY',
					symbol: symbol || default_pair,
					type: 'LIMIT',
					quantity: amount.toFixed(),
					price: price.toFixed()
				});
			} catch (e) {
				async_error_handler(null, null, e);
			}
		}
		async function do_limit_sell_order({ ee, price, amount } = {}) {
			try {
				return await ee.order({
					side: 'SELL',
					symbol: default_pair,
					type: 'LIMIT',
					quantity: amount.toFixed(),
					price: price.toFixed()
				});
			} catch (e) {
				async_error_handler(null, null, e);
			}
		}

		async function do_stop_loss_limit_sell_order({ ee, price, amount, stop_price } = {}) {
			try {
				return await ee.order({
					side: 'SELL',
					symbol: default_pair,
					type: 'STOP_LOSS_LIMIT',
					quantity: amount.toFixed(),
					price: price.toFixed(),
					stopPrice: stop_price ? stop_price.toFixed() : price.toFixed()
				});
			} catch (e) {
				async_error_handler(null, null, e);
			}
		}

		describe('exchangeInfo', function() {
			it('returns the object passed in to the constructor', async function() {
				const starting_quote_balance = BigNumber(1);
				const ee = setup({ logger, starting_quote_balance, exchange_info });
				const returned_ei = await ee.exchangeInfo();
				expect(returned_ei).to.equal(exchange_info);
			});
		});
		describe('set_current_price', function() {
			it('sends an event to .ws.aggTrades if it is a watched pair', async function() {
				const ee = setup({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(1)
				});
				let price_target = BigNumber('0.8');
				let event;
				let clean = await ee.ws.aggTrades([ default_pair ], (msg) => {
					event = msg;
				});
				await ee.set_current_price({ symbol: default_pair, price: price_target });
				expect(event).to.be.an('object');
				console.log(event);
				expect(event).to.include({
					symbol: default_pair,
					price: price_target
				});
			});
			it('sends an event to .ws.aggTrades if it is a watched pair (list)', async function() {
				const ee = setup({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(1)
				});
				let price_target = BigNumber('0.8');
				let event;
				await ee.ws.aggTrades([ default_pair, 'AIONBTC' ], (msg) => {
					event = msg;
				});
				await ee.set_current_price({ symbol: default_pair, price: price_target });
				expect(event).to.be.an('object');
				expect(event).to.include({
					symbol: default_pair,
					price: price_target
				});
				await ee.set_current_price({ symbol: 'AIONBTC', price: price_target });
				expect(event).to.be.an('object');
				expect(event).to.include({
					symbol: 'AIONBTC',
					price: price_target
				});
			});
			it.skip('doesnt send an event to .ws.aggTrades if it NOT is a watched pair');
		});
		describe('.cancelOrder()', async function() {
			it('removes the open order from the exchange', async function() {
				const ee = setup({ logger, exchange_info, starting_quote_balance: BigNumber(1) });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				await ee.cancelOrder({
					symbol: default_pair,
					orderId: 1
				});
				expect(ee.open_orders).to.have.lengthOf(0);
			});
			it('of buy limit order unlocks the quote_asset balance', async function() {
				let starting_quote_balance = BigNumber(1);
				const ee = setup({ logger, exchange_info, starting_quote_balance });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				await ee.cancelOrder({
					symbol: default_pair,
					orderId: 1
				});
				let balances = (await ee.accountInfo()).balances;
				let balance = balances.find((o) => o.asset === default_quote_currency);
				expect(balance.locked).to.bignumber.equal(0);
				expect(balance.free).to.bignumber.equal(starting_quote_balance);
			});
			it('of stop limit sell order unlocks the base_asset balance', async function() {
				let starting_base_balance = BigNumber(1);
				const ee = setup({ logger, exchange_info, starting_base_balance });
				const base_volume = BigNumber('1');
				const limit_price = BigNumber('0.1');
				await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				await ee.cancelOrder({
					symbol: default_pair,
					orderId: 1
				});

				let balances = (await ee.accountInfo()).balances;
				let balance = balances.find((o) => o.asset === default_base_currency);
				expect(balance.locked).to.bignumber.equal(0);
				expect(balance.free).to.bignumber.equal(starting_base_balance);
			});
			it.skip('sends a CANCELLED order message to .ws.user', async function() {
				const ee = setup({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let user_event;
				await ee.ws.user((msg) => {
					user_event = msg;
				});
				await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				await ee.cancelOrder({
					symbol: default_pair,
					orderId: 1
				});
				expect(user_event).not.to.be.undefined;
				expect(user_event).to.be.an('object');
				expect(user_event).to.include({
					eventType: 'executionReport',
					symbol: default_pair,
					orderId: 1,
					orderType: 'STOP_LOSS_LIMIT',
					side: 'SELL',
					orderStatus: 'CANCELLED'
				});
			});
		});
		describe('limit buy order', async function() {
			it('asserts pair exists', async function() {
				const ee = setup({ starting_quote_balance: BigNumber('2') });
				try {
					await do_limit_buy_order({ ee, amount: BigNumber('1'), price: BigNumber('1'), symbol: 'FOOBTC' });
				} catch (e) {
					expect(e.message).to.include('assert');
					expect(e.message).to.include('symbol');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if it is passed price below MIN_PRICE', async function() {
				const ee = setup({});
				try {
					await do_limit_buy_order({ ee, amount: BigNumber('1'), price: BigNumber('0.00000001') });
				} catch (e) {
					expect(e.message).to.include('PRICE_FILTER');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if it is passed volume below LOT_SIZE', async function() {
				const ee = setup({});
				try {
					await do_limit_buy_order({ ee, amount: BigNumber('0.0001'), price: BigNumber('1') });
				} catch (e) {
					expect(e.message).to.include('LOT_SIZE');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if trade value below MIN_NOTIONAL', async function() {
				const ee = setup({});
				try {
					await do_limit_buy_order({ ee, amount: BigNumber('0.001'), price: BigNumber('0.000001') });
				} catch (e) {
					expect(e.message).to.include('MIN_NOTIONAL');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('adds a limit_buy_order to open_orders', async function() {
				const ee = setup({ logger, exchange_info, starting_quote_balance: BigNumber(1) });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				expect(ee.open_orders.length).to.equal(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].symbol).to.equal(default_pair);
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
			it('returns the expected response object with orderID', async function() {
				const ee = setup({ logger, exchange_info, starting_quote_balance: BigNumber(1) });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				expect(response).to.have.property('orderId');
				expect(response.orderId).to.equal(1);
			});
			it.skip('locks the quote_currency balance');
			describe('when hit', async function() {
				it('reduces the locked quote_currency balance');
				it('increases the unlocked base_balance', async function() {
					const ee = setup({
						logger,
						exchange_info,
						starting_quote_balance: BigNumber(1),
						starting_base_balance: BigNumber(0)
					});
					const base_volume = BigNumber('1.2');
					const limit_price = BigNumber('0.1');
					let balances, base_balance;
					try {
						await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
						await ee.set_current_price({ symbol: default_pair, price: limit_price });
						balances = (await ee.accountInfo()).balances;
						base_balance = balances.find((o) => o.asset === default_base_currency);
						expect(base_balance.locked).to.bignumber.equal(0);
						expect(base_balance.free).to.bignumber.equal(base_volume);
					} catch (error) {
						console.log(error);
						expect.fail('expected not to throw');
					}
				});
				it('sends an executionReport to .ws.user', async function() {
					const ee = setup({
						logger,
						exchange_info,
						starting_quote_balance: BigNumber(1)
					});
					const base_volume = BigNumber('1.2');
					const limit_price = BigNumber('0.1');
					let user_event;
					let clean = await ee.ws.user((msg) => {
						user_event = msg;
					});
					let response = await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
					await ee.set_current_price({ symbol: default_pair, price: limit_price });
					expect(user_event).to.be.an('object');
					expect(user_event.totalTradeQuantity).to.be.a('string');
					expect(user_event).to.include({
						eventType: 'executionReport',
						symbol: default_pair,
						orderId: 1,
						orderType: 'LIMIT',
						side: 'BUY',
						orderStatus: 'FILLED',
						quantity: '1.2',
						totalTradeQuantity: '1.2'
					});
				});
				it.skip('defines price and quantity in these .ws.user events');
				it('throws Error(Account has insufficient balance for requested action.)');
			});
		});
		describe('limit sell order', async function() {
			it('asserts pair exists');
			it('throws if it is passed price below MIN_PRICE', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_limit_sell_order({ ee, amount: BigNumber('1'), price: BigNumber('0.00000001') });
				} catch (e) {
					expect(e.message).to.include('PRICE_FILTER');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if it is passed volume below LOT_SIZE', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_limit_sell_order({ ee, amount: BigNumber('0.0001'), price: BigNumber('1') });
				} catch (e) {
					expect(e.message).to.include('LOT_SIZE');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if trade value below MIN_NOTIONAL', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_limit_sell_order({ ee, amount: BigNumber('0.001'), price: BigNumber('0.000001') });
				} catch (e) {
					expect(e.message).to.include('MIN_NOTIONAL');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('adds a limit_sell_order to open_orders', async function() {
				const ee = setup({
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(ee.open_orders.length).to.equal(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].symbol).to.equal(default_pair);
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
			it('returns the expected response object with orderID', async function() {
				const ee = setup({
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(response).to.have.property('orderId');
				expect(response.orderId).to.equal(1);
			});
			describe('when hit', async function() {
				it('sends an executionReport to .ws.user', async function() {
					const ee = setup({
						starting_quote_balance: BigNumber(0),
						starting_base_balance: BigNumber(1)
					});
					const base_volume = BigNumber('0.8');
					const limit_price = BigNumber('0.1');
					let user_event;
					let clean = await ee.ws.user((msg) => {
						user_event = msg;
					});
					let response = await do_limit_sell_order({ ee, amount: base_volume, price: limit_price });
					await ee.set_current_price({ symbol: default_pair, price: limit_price });
					expect(user_event).to.be.an('object');
					expect(user_event.totalTradeQuantity).to.be.a('string');
					expect(user_event).to.include({
						eventType: 'executionReport',
						symbol: default_pair,
						orderId: 1,
						orderType: 'LIMIT',
						side: 'SELL',
						orderStatus: 'FILLED',
						quantity: '0.8',
						totalTradeQuantity: '0.8'
					});
				});
			});
			it('throws Error(Account has insufficient balance for requested action.)');
		});
		describe('STOP_LOSS_LIMIT order', async function() {
			it('asserts pair exists');
			// { Error: Order would trigger immediately.
			// 	at /Users/ryan/Dropbox/crypto/binance-tool/node_modules/binance-api-node/dist/http.js:51:19
			// 	at processTicksAndRejections (internal/process/next_tick.js:81:5)
			//   actual_name: 'AsyncErrorWrapper',
			//   name: 'Error',
			//   wrapped: true,
			//   message:
			//    '[AsyncErrorWrapper of Error] Order would trigger immediately.' }
			it('replicates the Binance behaviour: it rejects STOP_LOSS_LIMIT_ORDERS that would trigger immediately');

			it('throws if it is passed price below MIN_PRICE', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_stop_loss_limit_sell_order({ ee, amount: BigNumber('1'), price: BigNumber('0.00000001') });
				} catch (e) {
					expect(e.message).to.include('PRICE_FILTER');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if it is passed volume below LOT_SIZE', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_stop_loss_limit_sell_order({ ee, amount: BigNumber('0.0001'), price: BigNumber('1') });
				} catch (e) {
					expect(e.message).to.include('LOT_SIZE');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if trade value below MIN_NOTIONAL', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_stop_loss_limit_sell_order({
						ee,
						amount: BigNumber('0.001'),
						price: BigNumber('0.000001')
					});
				} catch (e) {
					expect(e.message).to.include('MIN_NOTIONAL');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if (limit) price precision is too high', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_stop_loss_limit_sell_order({
						ee,
						amount: BigNumber('1'),
						price: BigNumber('0.00100001'),
						stop_price: BigNumber('0.001')
					});
				} catch (e) {
					expect(e.message).to.include('Precision is over the maximum defined for this asset');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if (limit) price precision is too high', async function() {
				const ee = setup({
					starting_base_balance: BigNumber(1)
				});
				try {
					await do_stop_loss_limit_sell_order({
						ee,
						amount: BigNumber('1'),
						price: BigNumber('0.001'),
						stop_price: BigNumber('0.00200001')
					});
				} catch (e) {
					expect(e.message).to.include('Precision is over the maximum defined for this asset');
					return;
				}
				expect.fail('Expected call to throw');
			});
			it('throws if stop_price precision is too high');
			it('has tests for stop_price, including checking PRICE_FILTER and MIN_NOTIONAL');
			it('adds a STOP_LOSS_LIMIT to open_orders', async function() {
				const ee = setup({
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(ee.open_orders.length).to.equal(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].symbol).to.equal(default_pair);
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].stopPrice.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
			it('returns the expected response object with orderID', async function() {
				const ee = setup({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(response).to.have.property('orderId');
				expect(response.orderId).to.equal(1);
			});
			it('throws Error(Account has insufficient balance for requested action.)');
			it('refuses order if insufficient balance', async function() {
				const ee = setup({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(0)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				try {
					await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
					expect.fail('Expected call to throw');
				} catch (e) {
					expect(e.name).to.equal('InsufficientBalanceError');
				}
			});
			describe('when hit (exactly on the limit price)', async function() {
				it('sends an executionReport to .ws.user', async function() {
					const ee = setup({
						logger,
						exchange_info,
						starting_quote_balance: BigNumber(0),
						starting_base_balance: BigNumber(1)
					});
					const base_volume = BigNumber('0.8');
					const limit_price = BigNumber('0.1');
					let user_event;
					await ee.ws.user((msg) => {
						user_event = msg;
					});
					await do_stop_loss_limit_sell_order({ ee, amount: base_volume, price: limit_price });
					await ee.set_current_price({ symbol: default_pair, price: limit_price });
					expect(user_event).to.be.an('object');
					expect(user_event.totalTradeQuantity).to.be.a('string');
					expect(user_event).to.include({
						eventType: 'executionReport',
						symbol: default_pair,
						orderId: 1,
						orderType: 'STOP_LOSS_LIMIT',
						side: 'SELL',
						orderStatus: 'FILLED',
						quantity: '0.8',
						totalTradeQuantity: '0.8'
					});
				});
			});
			it('probably doesnt implement the stop price yet');
		});
	});

	describe('.accountInfo', function() {
		it('when quote currency held: details the amount of quote currency held', async function() {
			const ee = setup({
				logger,
				exchange_info,
				starting_quote_balance: BigNumber(200),
				starting_base_balance: BigNumber(0)
			});
			let response = await ee.accountInfo();
			expect(response).to.have.property('balances');
			let balances = response.balances;
			expect(balances).to.have.lengthOf(1);
			expect(balances[0].asset).to.equal(default_quote_currency);
			expect(balances[0].free).to.bignumber.equal(200);
			expect(balances[0].locked).to.bignumber.equal(0);
		});
		it('when base currency held: details the amount of base currency held', async function() {
			const ee = setup({
				logger,
				exchange_info,
				starting_quote_balance: BigNumber(0),
				starting_base_balance: BigNumber(200)
			});
			let response = await ee.accountInfo();
			expect(response).to.have.property('balances');
			let balances = response.balances;
			expect(balances).to.have.lengthOf(1);
			expect(balances[0].asset).to.equal(default_base_currency);
			expect(balances[0].free).to.bignumber.equal(200);
			expect(balances[0].locked).to.bignumber.equal(0);
		});
		it('differentiates locked and available funds');
	});
	describe('.prices', function() {
		it('returns all known prices', async function() {
			const ee = setup({
				logger,
				exchange_info
			});
			await ee.set_current_price({ symbol: default_pair, price: BigNumber('1.1') });
			await ee.set_current_price({ symbol: 'FOOBTC', price: BigNumber('3') });
			let prices = await ee.prices();
			expect(Object.keys(prices)).to.have.lengthOf(2);
			expect(prices[default_pair]).to.bignumber.equal('1.1');
			expect(prices['FOOBTC']).to.bignumber.equal('3');
		});
		it('returns an empty object when no prices are known', async function() {
			const ee = setup({
				logger,
				exchange_info
			});
			let prices = await ee.prices();
			expect(Object.keys(prices)).to.have.lengthOf(0);
		});
	});
});

it('fails if order gets passed unmunged values Notional, step and lot_size');
it('has some decent tests for stop limit sell orders');
