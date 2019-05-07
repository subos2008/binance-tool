'use strict';
const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Logger = require('../lib/faux_logger');
const { NotImplementedError, InsufficientBalanceError } = require('../lib/errors');
// const async_error_handler = require('../lib/async_error_handler');
const utils = require('../lib/utils');
const fs = require('fs');
const Algo = require('../service_lib/algo');

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

// Tests needed:
// .exchangeInfo
// .order(args)
// .ws.aggTrades([ pair ], (trade) => {
// .ws.user((data) => {

const default_pair = 'ETHBTC';
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

describe('Algo', function() {
	function setup({ algo_config, ee_config } = {}) {
		ee_config = Object.assign({ logger, exchange_info, starting_quote_balance: BigNumber(1) }, ee_config);
		let ee = new ExchangeEmulator(ee_config);
		algo_config = Object.assign({ send_message: (msg) => console.log(`send_message: ${msg}`) }, algo_config);
		let algo = new Algo(Object.assign(algo_config, { ee }));
		return { algo, ee };
	}

	describe('constructor', function() {
		it.skip('does some stuff', function() {
			// let ee = setup_ee();
			// expect(ee.quote_coin_balance_not_in_orders.isEqualTo(starting_quote_balance)).to.equal(true);
		});
	});

	describe('when only a buyPrice is present', function() {
		it('creates a buy order and returns', async function() {
			const base_volume = BigNumber(1);
			const limit_price = BigNumber(1);
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					amount: base_volume,
					buyPrice: limit_price
				}
			});
			try {
				await algo.main();
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('BUY');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
		});
	});

	describe('when only a buyPrice and a stopPrice present', function() {
		it('creates a buy order and returns', async function() {
			const amount = BigNumber(1);
			const buyPrice = BigNumber(1);
			const stopPrice = buyPrice.div(2);
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					amount,
					buyPrice,
					stopPrice
				}
			});
			try {
				await algo.main();
				await ee.set_current_price({ price: buyPrice });
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(2);
			expect(ee.open_orders[0].price.isEqualTo(stopPrice)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when only a stopPrice present', function() {
		it('creates a stop order and returns', async function() {
			const amount = BigNumber(1);
			const stopPrice = BigNumber('0.5');
			let { ee, algo } = setup({
				ee_config: {
					starting_base_balance: BigNumber(1)
				},
				algo_config: {
					pair: default_pair,
					amount,
					stopPrice
				}
			});
			try {
				await algo.main();
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].price.isEqualTo(stopPrice)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
});
