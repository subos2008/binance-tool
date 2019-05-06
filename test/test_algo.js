'use strict';
const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Logger = require('../lib/faux_logger');
const { NotImplementedError, InsufficientQuoteBalanceError } = require('../lib/errors');
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
	function setup({ algo_config } = {}) {
		let starting_quote_balance = BigNumber(1);
		let ee = new ExchangeEmulator({ logger, exchange_info, starting_quote_balance });
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
		it('creates a buy order and exits', async function() {
			let { algo } = setup({
				algo_config: {
					pair: default_pair,
					amount: '1',
					buyPrice: '1'
				}
			});
			try {
				await algo.main();
				expect.fail('should not get here: expected call to throw');
			} catch (e) {
				console.log(e);
				expect(e.name).to.equal('ExecutionComplete');
			}
		});
	});
});
