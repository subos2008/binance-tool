'use strict';
const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Logger = require('../lib/faux_logger');
const { NotImplementedError, InsufficientQuoteBalanceError } = require('../lib/errors');
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

const default_pair = 'ETHUSDT';
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

describe('ExchangeEmulator', function() {
	describe('constructor', function() {
		it('sets quote_coin_balance_not_in_orders to starting_quote_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			expect(ee.quote_coin_balance_not_in_orders.isEqualTo(starting_quote_balance)).to.equal(true);
		});
		it('sets base_coin_balance_not_in_orders to starting_base_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance, starting_base_balance });
			expect(ee.base_coin_balance_not_in_orders.isEqualTo(starting_base_balance)).to.equal(true);
		});
		it('sets balance_in_quote_coin to starting_quote_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			expect(ee.balance_in_quote_coin().isEqualTo(starting_quote_balance)).to.equal(true);
		});
		it('sets quote_coin_balance_in_orders to zero', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			expect(ee.quote_coin_balance_in_orders.isEqualTo(0)).to.equal(true);
		});
		it('dumps ok', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			ee.dump();
		});
		it('balance_in_quote_coin is equal to starting_quote_balance', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			expect(ee.balance_in_quote_coin().isEqualTo(starting_quote_balance)).to.equal(true);
		});
	});

	describe('add_limit_buy_order', function() {
		it.skip(
			'raises an async InsufficientQuoteBalanceError if quote_coin_balance_not_in_orders is insufficient',
			async function() {
				const starting_quote_balance = BigNumber(1);
				const ee = new ExchangeEmulator({ logger: null_logger, starting_quote_balance });
				try {
					await ee.add_limit_buy_order({
						base_volume: BigNumber(2),
						limit_price: BigNumber('1'),
						pair: default_pair
					});
				} catch (e) {
					expect(e).to.be.instanceOf(Error);
					expect(e).to.have.property('original_name', 'InsufficientQuoteBalanceError');
					return;
				}
				expect.fail('should not get here: expected call to throw');
			}
		);

		it('decreases quote_coin_balance_not_in_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			await ee.add_limit_buy_order({ base_volume: BigNumber(1), limit_price: BigNumber(1), pair: default_pair });
			expect(ee.quote_coin_balance_not_in_orders.isEqualTo(0)).to.equal(true);
		});
		it('increases quote_coin_balance_in_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_buy_order({ base_volume, limit_price, pair: default_pair });
			const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: limit_price });
			expect(ee.quote_coin_balance_in_orders.isEqualTo(quote_volume)).to.equal(true);
		});
		it('adds a limit_buy_order to open_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance });
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
		it.skip('fails if base_coin_balance_not_in_orders is insufficient', async function() {
			expect(false).to.equal(true);
		});
		it('decreases base_coin_balance_not_in_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance, starting_base_balance });
			await ee.add_limit_sell_order({ base_volume: BigNumber(1), limit_price: BigNumber(1), pair: default_pair });
			expect(ee.base_coin_balance_not_in_orders).to.be.bignumber.equal(3);
		});
		it('increases base_coin_balance_in_orders', async function() {
			//should fail
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance, starting_base_balance });
			const base_volume = BigNumber(2);
			const limit_price = BigNumber(1);
			await ee.add_limit_sell_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.base_coin_balance_in_orders).to.be.bignumber.equal(base_volume);
		});
		it('adds a limit_sell_order to open_orders', async function() {
			const starting_quote_balance = BigNumber(1);
			const starting_base_balance = BigNumber(4);
			const ee = new ExchangeEmulator({ logger, starting_quote_balance, starting_base_balance });
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
			const ee = new ExchangeEmulator({ logger, starting_quote_balance, starting_base_balance });
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			await ee.add_limit_sell_order({ base_volume, limit_price, pair: default_pair });
			await ee.add_limit_buy_order({ base_volume, limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(2);
			await ee.cancel_all_open_orders();
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.base_coin_balance_in_orders).to.be.bignumber.equal(0);
			expect(ee.base_coin_balance_not_in_orders).to.be.bignumber.equal(starting_base_balance);
			expect(ee.quote_coin_balance_in_orders).to.be.bignumber.equal(0);
			expect(ee.quote_coin_balance_not_in_orders).to.be.bignumber.equal(starting_quote_balance);
		});
	});

	describe('BNB and trading fees', function() {
		it('correctly handles trading fee deductions');
		it('understands if you dont have enough BNB for a trade and ...');
		it('deducts from BNB balance if set to do so');
		it('deducts from ??? if not set to use BNB');
	});

	describe('check_for_completed_limit_orders', function() {
		it('executes a limit buy order', async function() {
			const starting_quote_balance = BigNumber(3);
			const starting_base_balance = BigNumber(0);
			const limit_price = BigNumber(1);
			const ee = new ExchangeEmulator({ logger: null_logger, starting_quote_balance, starting_base_balance });
			await ee.set_current_price({ price: limit_price.plus(1) }); // start higher than limit price
			await ee.add_limit_buy_order({ base_volume: BigNumber(3), limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			await ee.set_current_price({ price: limit_price });
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.base_coin_balance_not_in_orders).to.be.bignumber.equal(3);
			expect(ee.quote_coin_balance_not_in_orders).to.be.bignumber.equal(0);
			// TODO: fees
		});
		it('executes a limit sell order', async function() {
			const starting_quote_balance = BigNumber(0);
			const starting_base_balance = BigNumber(3);
			const limit_price = BigNumber(1);
			const ee = new ExchangeEmulator({ logger: null_logger, starting_quote_balance, starting_base_balance });
			await ee.set_current_price({ price: limit_price.minus(1) }); // start lower than limit price
			await ee.add_limit_sell_order({ base_volume: BigNumber(3), limit_price, pair: default_pair });
			expect(ee.open_orders.length).to.equal(1);
			await ee.set_current_price({ price: limit_price });
			expect(ee.open_orders.length).to.equal(0);
			expect(ee.base_coin_balance_not_in_orders).to.be.bignumber.equal(0);
			expect(ee.quote_coin_balance_not_in_orders).to.be.bignumber.equal(3);
			// TODO: fees
		});
		it('correctly handles both buy and sell orders');
		// TODO: I guess actually the test here is that Binance refuses to take limit orders that
		// TODO: would execute immediately
		it('doesnt execute a limit buy if the starting price was lower...some shit like that');
	});

	describe('binance-api-node API', function() {
		async function do_limit_buy_order({ ee, price, amount } = {}) {
			return await ee.order({
				side: 'BUY',
				symbol: default_pair,
				type: 'LIMIT',
				quantity: amount.toFixed(),
				price: price.toFixed()
			});
		}
		async function do_limit_sell_order({ ee, price, amount } = {}) {
			return await ee.order({
				side: 'SELL',
				symbol: default_pair,
				type: 'LIMIT',
				quantity: amount.toFixed(),
				price: price.toFixed()
			});
		}

		describe('exchangeInfo', function() {
			it('returns the object passed in to the constructor', async function() {
				const starting_quote_balance = BigNumber(1);
				const ee = new ExchangeEmulator({ logger, starting_quote_balance, exchange_info });
				const returned_ei = await ee.exchangeInfo();
				expect(returned_ei).to.equal(exchange_info);
			});
		});
		describe('limit buy order', async function() {
			it('adds a limit_buy_order to open_orders', async function() {
				const ee = new ExchangeEmulator({ logger, exchange_info, starting_quote_balance: BigNumber(1) });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				expect(ee.open_orders.length).to.equal(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
			it('returns the expected response object with orderID', async function() {
				const ee = new ExchangeEmulator({ logger, exchange_info, starting_quote_balance: BigNumber(1) });
				const base_volume = BigNumber('1.2');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_buy_order({ ee, amount: base_volume, price: limit_price });
				expect(response).to.have.property('orderId');
				expect(response.orderId).to.equal(1);
			});
		});
		describe('limit sell order', async function() {
			it('adds a limit_sell_order to open_orders', async function() {
				const ee = new ExchangeEmulator({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(ee.open_orders.length).to.equal(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
			it('returns the expected response object with orderID', async function() {
				const ee = new ExchangeEmulator({
					logger,
					exchange_info,
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(1)
				});
				const base_volume = BigNumber('0.8');
				const limit_price = BigNumber('0.1');
				let response = await do_limit_sell_order({ ee, amount: base_volume, price: limit_price });
				expect(response).to.have.property('orderId');
				expect(response.orderId).to.equal(1);
			});
		});
	});
});
