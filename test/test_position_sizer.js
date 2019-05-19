'use strict';
const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Logger = require('../lib/faux_logger');
const async_error_handler = require('../lib/async_error_handler');
const utils = require('../lib/utils');
const PositionSizer = require('../service_lib/position_sizer');
const TradingRules = require('../service_lib/trading_rules');

const fs = require('fs');

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

const permissive_trading_rules = {
	max_allowed_portfolio_loss_percentage_per_trade: BigNumber(100),
	allowed_to_trade_without_stop: true
};

const default_base_currency = 'ETH';
const default_quote_currency = 'BTC';
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

describe('PositionSizer', function() {
	function setup({ ee_config } = {}) {
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
		let ee = new ExchangeEmulator(ee_config);
		let position_sizer_config = { ee, logger, trading_rules: new TradingRules(permissive_trading_rules) };
		return { ee, position_sizer: new PositionSizer(position_sizer_config) };
	}

	describe('constructor', function() {
		it.skip('errors if stop is not present and trading_rules.allowed_to_trade_without_stop', function() {
			const starting_quote_balance = BigNumber(1);
			const ee = setup({ logger, starting_quote_balance });
			expect(ee.balance_not_in_orders(default_quote_currency).isEqualTo(starting_quote_balance)).to.equal(true);
		});
	});

	describe('_get_portfolio_value_from_exchange', function() {
		it('when only quote currency held: returns the total amount of quote currency held', async function() {
			let { ee, position_sizer } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(200)
				}
			});
			let response = await position_sizer._get_portfolio_value_from_exchange({
				quote_currency: default_quote_currency
			});
			expect(response).to.have.property('total');
			expect(response.total).to.bignumber.equal(200);
			expect(response.available).to.bignumber.equal(200);
		});
		it('when only default base currency held: returns the equvalent amount of quote currency held', async function() {
			let { ee, position_sizer } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(201)
				}
			});
			let response;
			try {
				await ee.set_current_price({ symbol: default_pair, price: BigNumber('0.5') });
				response = await position_sizer._get_portfolio_value_from_exchange({
					quote_currency: default_quote_currency
				});
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(response).to.have.property('total');
			expect(response.total).to.bignumber.equal('100.5');
			expect(response.available).to.bignumber.equal('0');
		});
		it('with a mix of currencies', async function() {
			let { ee, position_sizer } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(2),
					starting_base_balance: BigNumber(201)
				}
			});
			let response;
			try {
				await ee.set_current_price({ symbol: default_pair, price: BigNumber('0.5') });
				response = await position_sizer._get_portfolio_value_from_exchange({
					quote_currency: default_quote_currency
				});
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(response).to.have.property('total');
			expect(response.total).to.bignumber.equal('102.5');
			expect(response.available).to.bignumber.equal('2');
		});

		it('Converts held base currencies to their equavalent in the supplied quote currency and adds that in');
		it('Handles base currencies that dont have a direct pairing to the quote currency');
	});
});
