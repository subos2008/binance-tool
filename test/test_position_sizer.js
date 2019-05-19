'use strict';
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
const default_quote_currency = 'USDT';
const quote_currency = default_quote_currency;
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

describe('PositionSizer', function() {
	function setup({ ee_config, ps_config } = {}) {
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
		ps_config = Object.assign(
			{
				ee,
				logger: null_logger,
				trading_rules: new TradingRules(permissive_trading_rules)
			},
			ps_config
		);
		return { ee, position_sizer: new PositionSizer(ps_config) };
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
		it('Handles base currencies that dont have a direct pairing to the quote currency, ie. via BTC');
	});

	describe('with auto_size', function() {
		it('needs buy_price, stop_price, trading_rules');
		it('throws an error in the constructor if it doesnt have the information it needs to auto-size');
		it('clips the quote_coin size to max_quote_amount_to_buy');
		it('errors if no stop_price is passed and !trading_rules.allowed_to_trade_without_stop');

		it.skip('calculates the max amount to buy based on portfolio value and stop_percentage', async function() {
			const buy_price = BigNumber(1);
			const stop_price = buy_price.times('0.98');
			const trading_rules = {
				max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
			};
			let { ee, algo } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(1)
				}
			});
			try {
				await algo.main();
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			// check for a buy order placed at an appropriate size: 2% stop and 1% max loss => 50% of portfolio
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('BUY');
			expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
			expect(ee.open_orders[0].price).to.bignumber.equal(buy_price);
		});

		it('handles attempted trades below the min notional cleanly');
		it('respects max_base_amount_to_buy');
		it(
			'max_base_amount_to_buy ... do we want to use that not as a max but as an abolute value? .. i.e if auto-size isnt passed'
		);
	});
	describe('with do_not_auto_size_for_stop_percentage', function() {
		it('returns max_quote_to_buy when available', async function() {
			const trading_rules = {
				max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
			};
			let { ee, position_sizer } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(5)
				},
				ps_config: {
					trading_rules
				}
			});
			try {
				let { quote_volume, base_amount } = await position_sizer.size_position({
					buy_price: BigNumber(2),
					stop_price: BigNumber(0.5),
					max_quote_amount_to_buy: BigNumber(5),
					do_not_auto_size_for_stop_percentage: true,
					quote_currency
				});
				expect(quote_volume).to.bignumber.equal(5);
				expect(base_amount).to.bignumber.equal('2.5');
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
		});
		it('returns available quote_amount if less than max_quote_to_buy', async function() {
			const trading_rules = {
				max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
			};
			let { ee, position_sizer } = setup({
				ee_config: {
					starting_quote_balance: BigNumber(5)
				},
				ps_config: {
					trading_rules
				}
			});
			try {
				let { quote_volume, base_amount } = await position_sizer.size_position({
					buy_price: BigNumber(2),
					stop_price: BigNumber(0.5),
					max_quote_amount_to_buy: BigNumber(3),
					do_not_auto_size_for_stop_percentage: true,
					quote_currency
				});
				expect(quote_volume).to.bignumber.equal(3);
				expect(base_amount).to.bignumber.equal('1.5');
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
		});
	});
});
