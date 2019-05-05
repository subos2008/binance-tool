'use strict';

const chai = require('chai');
chai.use(require('chai-bignumber')());
const expect = chai.expect;

const BigNumber = require('bignumber.js');

const ExchangeEmulator = require('../lib/exchange_emulator');
const Algo = require('../service-lib/algo_trade_range');
const AlgoConfig = require('../service-lib/algo_config');
const AlgoRunner = require('../service-lib/algo_runner');
const Logger = require('../lib/faux_logger');
const { NotImplementedError } = require('../lib/errors');
const async_error_handler = require('../lib/async_error_handler');
const asyncForEach = require('../lib/async_foreach');

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

// function convert_klines_to_bignums(klines) {
//   return klines.map(function(bar) {
//     return {
//       open: BigNumber(bar["open"]),
//       low: BigNumber(bar["low"]),
//       high: BigNumber(bar["high"]),
//       close: BigNumber(bar["close"])
//     };
//   });
// }

// const klines_flat_prices = convert_klines_to_bignums([
//   { open: "1", close: "1", high: "1", low: "1" },
//   { open: "1", close: "1", high: "1", low: "1" },
//   { open: "1", close: "1", high: "1", low: "1" },
//   { open: "1", close: "1", high: "1", low: "1" }
// ]);

// const klines_only_up = convert_klines_to_bignums([
//   { open: "1", close: "1", high: "1", low: "1" },
//   { open: "1", close: "2", high: "2", low: "1" },
//   { open: "2", close: "3", high: "3", low: "2" },
//   { open: "3", close: "4", high: "4", low: "3" },
//   { open: "4", close: "5", high: "5", low: "4" }
// ]);

// const one_kline_only = convert_klines_to_bignums([
//   { open: "1", close: "1", high: "1", low: "1" }
// ]);

// TODO: would be cleaner if this returned an array that we
// TODO: checked in the calling test
// async function calculate_balances_with_config({ algo_config, klines, logger } = {}) {
// 	const starting_quote_balance = BigNumber(1);
// 	const ee = new ExchangeEmulator({ logger, starting_quote_balance });
// 	const first_price = klines[0]['open'];
// 	NOW ASYNC!!! ee.set_current_price({ price: first_price });
// 	algo = new Algo({
// 		logger,
// 		algo_config,
// 		ee,
// 		quote_coin_balance_allocated: starting_quote_balance,
// 		base_coin_balance_allocated: BigNumber(0)
// 	});
// 	try {
// 		await algo.fully_invest();
// 	} catch (e) {
// 		async_error_handler(this.logger, 'Test: Exception while investing', e);
// 	}
// 	algo_runner = new AlgoRunner({ logger, ee, algo });
// 	try {
// 		const balances = [];
// 		await asyncForEach(logger, klines, async function(bar, index) {
// 			try {
// 				await algo_runner.ingest_bar({ bar });
// 				balances.push(ee.balance_in_quote_coin());
// 			} catch (e) {
// 				async_error_handler(logger, 'Test: Exception *********', e);
// 			}
// 		});
// 		return balances;
// 	} catch (e) {
// 		async_error_handler(logger, 'Test: Exception *********', e);
// 	}
// }

// function check_balances_were_as_expected(
//   calculated_balances,
//   expected_balances
// ) {
//   calculated_balances.forEach(function(balance, index) {
//     if (index > 0) {
//       console.log(`${balance} is ${expected_balances[index]}`);
//       expect(expected_balances[index].isEqualTo(balance)).to.equal(true);
//     }
//   });
// }

// describe('Service', function() {
// 	describe('when there are existing balances on startup', function() {
// 		it('should do something with the open trades and their associated sell orders', async function() {
// 			expect(false).to.equal(true);
// 		});
// 	});

// 	describe('with re-investment', function() {
// 		it('should have no quote coin left to re-invest after start_of_day returns', async function() {
// 			const starting_quote_balance = BigNumber(1);
// 			const ee = new ExchangeEmulator({
// 				logger: null_logger,
// 				starting_quote_balance
// 			});
// 			algo = new Algo({
// 				logger: null_logger,
// 				algo_config: algo_config_sell_all_at_five_percent,
// 				ee,
// 				quote_coin_balance_allocated: starting_quote_balance,
// 				base_coin_balance_allocated: BigNumber(0),
// 				with_reinvestment: true
// 			});

// 			try {
// 				await algo.start_of_day({
// 					open_price: BigNumber(one_kline_only[0]['open'])
// 				});
// 			} catch (e) {
// 				logger.info(`Exception ********* ${e} ${e.wrapped ? '' : e.stack}`);
// 				expect(false).to.equal(true);
// 			}

// 			expect(algo.quote_coin_available_to_invest.isZero()).to.equal(true);
// 			expect(algo.base_coin_balance.isEqualTo(1)).to.equal(true);
// 		});
// 		it('test muliple reinvested klines with one sell order', async function() {
// 			const expected_balances = [
// 				null,
// 				BigNumber('1.05'),
// 				BigNumber('1.1025'),
// 				BigNumber('1.157625'),
// 				BigNumber('1.21550625')
// 			];
// 			try {
// 				calculated_balances = await calculate_balances_with_config({
// 					algo_config: algo_config_sell_all_at_five_percent,
// 					klines: klines_only_up,
// 					with_reinvestment: true,
// 					logger: null_logger
// 				});
// 			} catch (e) {
// 				logger.info(`Exception ********* ${e} ${e.wrapped ? '' : e.stack}`);
// 				expect(false).to.equal(true);
// 			}
// 			check_balances_were_as_expected(calculated_balances, expected_balances);
// 		});
// 	});

// 	describe('without re-investment', function() {
// 		// This makes sure limit sells don't always hit
// 		it('should maintain a constant balance on flat klines', async function() {
// 			const expected_balances = [ null, BigNumber('1'), BigNumber('1'), BigNumber('1') ];
// 			try {
// 				calculated_balances = await calculate_balances_with_config({
// 					algo_config: algo_config_sell_all_at_five_percent,
// 					klines: klines_flat_prices,
// 					with_reinvestment: false,
// 					logger: null_logger
// 				});
// 			} catch (e) {
// 				logger.error(`Exception ********* ${e} ${e.wrapped ? '' : e.stack}`);
// 				expect(false).to.equal(true);
// 			}
// 			check_balances_were_as_expected(calculated_balances, expected_balances);
// 		});

// 		// This fails because the algo doesn't invest or initialise with the values from
// 		// the exchange for amount of base_coin held
// 		it("test muliple upward klines hits one sell order but doesn't reinvest", async function() {
// 			const expected_balances = [
// 				null,
// 				BigNumber('1.05'),
// 				BigNumber('1.05'),
// 				BigNumber('1.05'),
// 				BigNumber('1.05')
// 			];
// 			try {
// 				calculated_balances = await calculate_balances_with_config({
// 					algo_config: algo_config_sell_all_at_five_percent,
// 					klines: klines_only_up,
// 					with_reinvestment: false,
// 					logger: null_logger
// 				});
// 			} catch (e) {
// 				logger.error(`Exception ********* ${e} ${e.wrapped ? '' : e.stack}`);
// 				expect(false).to.equal(true);
// 			}
// 			check_balances_were_as_expected(calculated_balances, expected_balances);
// 		});
// 	});
// });

describe('AlgoTradeRange', function() {
	// describe('when there are existing balances on startup (...tiny vs expected size?)', function() {
	// 	describe('and no existing buy or sell orders', function() {
	// 		it('should set a sell order at the sell price', async function() {
	// 			expect(false).to.equal(true);
	// 		});
	// 	});
	// });

	const algo_config = new AlgoConfig({
		logger: logger,
		buy_price: BigNumber('0.00052000'),
		target_price: BigNumber('0.00060000'),
		stop_price: BigNumber('0.00050000')
	});

	// Startup Tests:
	// Existing balances
	// set limit buy when the price is below the buy price and it immediately executes
	// when exisitng balance satisfies the allocated amount then set a sell
	// sets a limit sell order for any existing balances on startup
	// cancels all open orders on startup - safest and ok if limited to specified pairs

	// what happens if the limit order gets executed immediately?

	describe('startup', function() {
		describe('munging prices with exchange_info and making checks', function() {
			describe('the munge', function() {
				it('munges and checks minPrice and minNotional for each price');
			});

			describe('post-munge', function() {
				it('fails unless stop_price is present');
				it('fails unless target_price price is present');
				it('fails unless buy_price price is present');
				it('fails unless stop_price is below buy_price');
				it('fails unless target_price is above buy_price');
			});
		});

		describe('when base balance is exactly zero', function() {
			describe('with no existing buy or sell orders', function() {
				it('adds a buy order at the buy price', async function() {
					const starting_quote_balance = BigNumber(1);
					const ee = new ExchangeEmulator({ logger: null_logger, starting_quote_balance });
					const algo = new Algo({
						logger: null_logger,
						algo_config,
						ee,
						quote_coin_balance_allocated: starting_quote_balance,
						base_coin_balance_allocated: BigNumber(0),
						with_reinvestment: false
					});

					try {
						await algo.startup();
					} catch (e) {
						logger.error(e);
						expect.fail('should not throw');
					}
					expect(ee.open_orders.length).to.equal(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].orderId).to.equal(1);
					expect(ee.open_orders[0].price).to.be.bignumber.equals(algo_config.buy_price);
				});
			});
		});
		describe('when there are any existing orders for the pair', function() {
			it.skip('exits the process?');
		});
	});
	describe('when buy/sell/stop order is cancelled', function() {
		it.skip('exits the process?');
	});
	describe('when a stop is hit', function() {
		it.skip('exits the process?');
		it.skip('sends a message to the message publisher?');
		it.skip('handles a partial fill on the stop?');
		it.skip('uses a market sell if stop price is already above the market price'); // this does happen, the exchange will bounce the limit order as invalid
	});

	describe('when buy order is filled', function() {
		const starting_quote_balance = BigNumber(1);
		var ee, algo;

		beforeEach('create buy and fill it', async function() {
			ee = new ExchangeEmulator({ logger: null_logger, starting_quote_balance });
			algo = new Algo({
				logger: null_logger,
				algo_config,
				ee,
				quote_coin_balance_allocated: starting_quote_balance,
				base_coin_balance_allocated: BigNumber(0),
				with_reinvestment: false
			});

			try {
				await algo.startup();
				await ee.set_current_price({ price: algo_config.buy_price });
			} catch (e) {
				logger.error(e);
				expect.fail('should not throw');
			}
		});

		it('creates a stop-limit order at the stop price [TODO: for the amount bought]', async function() {
			// TODO: wait - we should be waiting for some kind of trigger here, right?
			// TODO: that says the buy order got filled? Don't we get some kind of callback?
			// TODO: i.e. it calls a bound method like Algo.limit_buy_order_filled
			expect(ee.open_orders.length).to.equal(1);
			expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].price).to.be.bignumber.equals(algo_config.stop_price);
			// TODO: also check amount
		});

		it.skip('acts ok if a sell order already exists'); // created from a partial buy or pre-existing
	});
	describe('when buy order is partially filled..?', function() {
		it.skip('Re-invests a partial sell when back at the buy price');
		it.skip('updates sell orders to sell bought amounts');
		it.skip('acts appropriately ');
	});
	describe('when sell order is partially filled', function() {
		it.skip('...?');
		it.skip('when buy orders already exist?');
		it.skip('when buy orders dont already exist?');
	});
	describe('when sell order is filled', function() {
		it.skip('creates a buy order at the buy price for the ');
	});

	describe('re-investment', function() {
		it.skip('Re-invests a partial sell when back at the buy price');
		it.skip('updates sell orders to sell re-invested amounts');
	});
});
