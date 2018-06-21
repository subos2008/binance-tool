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
const TradeExecutor = require('../service_lib/trade_executor');

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

const permissive_trading_rules = {
	max_allowed_portfolio_loss_percentage_per_trade: BigNumber(100),
	allowed_to_trade_without_stop: true
};

let default_stop_limt_price_factor = BigNumber('0.8'); // hard coded default in algo atm

let message_queue = [];
function fresh_message_queue() {
	message_queue = [];
	return (msg) => {
		message_queue.push(msg);
	};
}

function most_recent_message() {
	return message_queue[message_queue.length - 1];
}

function aggrivate_price(price) {
	return BigNumber(price).plus('0.00000001'); // will trigger the PRICE_FILTER unless prices are munged
}
function aggrivate_amount(base_amount) {
	return BigNumber(base_amount).plus('.0001'); // will trigger the LOT_SIZE unless base_amount is munged
}

describe('TradeExecutor', function() {
	function setup({ algo_config, ee_config, no_agitate } = {}) {
		ee_config = Object.assign(
			{
				logger: null_logger,
				exchange_info
			},
			ee_config
		);
		if (ee_config.starting_quote_balance || ee_config.starting_base_balance) {
			ee_config.starting_balances = {};
		}
		if (ee_config.starting_quote_balance) {
			ee_config.starting_balances[default_quote_currency] = ee_config.starting_quote_balance;
		} else {
			if (!ee_config.starting_balances) {
				ee_config.starting_balances = {};
				ee_config.starting_balances[default_quote_currency] = BigNumber(1);
			}
		}
		if (ee_config.starting_base_balance)
			ee_config.starting_balances[default_base_currency] = ee_config.starting_base_balance;
		let ee = new ExchangeEmulator(ee_config);

		algo_config = Object.assign(
			{ ee, logger: null_logger, send_message: fresh_message_queue(), trading_rules: permissive_trading_rules },
			algo_config
		);
		if (!algo_config.pair && !algo_config.virtualPair) {
			algo_config.pair = default_pair;
		}
		if (!no_agitate) {
			if (algo_config.buy_price) algo_config.buy_price = aggrivate_price(algo_config.buy_price);
			if (algo_config.stop_price) algo_config.stop_price = aggrivate_price(algo_config.stop_price);
			if (algo_config.limit_price) algo_config.limit_price = aggrivate_price(algo_config.limit_price);
			if (algo_config.target_price) algo_config.target_price = aggrivate_price(algo_config.target_price);
			if (algo_config.base_amount_to_buy)
				algo_config.base_amount_to_buy = aggrivate_amount(algo_config.base_amount_to_buy);
			if (algo_config.base_amount_held)
				algo_config.base_amount_held = aggrivate_amount(algo_config.base_amount_held);
			if (algo_config.max_quote_amount_to_buy)
				algo_config.max_quote_amount_to_buy = aggrivate_amount(algo_config.max_quote_amount_to_buy);
		}
		let algo = new TradeExecutor(algo_config);
		return { algo, ee };
	}

	describe('constructor', function() {
		it.skip('does some stuff', function() {
			// let ee = setup_ee();
			// expect(ee.quote_coin_balance_not_in_orders.isEqualTo(starting_quote_balance)).to.equal(true);
		});
	});

	describe('when only a buy_price is present', function() {
		describe('when only an base_amount_to_buy is specified (base, not quote)', function() {
			it('doesnt autosize and uses the passed in base_amount_to_buy');
		});
		it('if auto-size and -q specified then use -q as a max');
		it('if -q specified without auto-size then use -q as an absolute (trim it to available)');
		describe('without soft_entry', function() {
			describe('with max_quote_amount_to_buy and without autosize', function() {
				it('creates a buy order for the available quote if it it less than the max specified', async function() {
					const buy_price = BigNumber(1);
					let { ee, algo } = setup({
						algo_config: {
							buy_price,
							max_quote_amount_to_buy: BigNumber(1)
						},
						ee_config: {
							starting_quote_balance: BigNumber('0.5')
						}
					});
					try {
						await algo.main();
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.buyOrderId).to.equal(1);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].orderId).to.equal(1);
					expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
					expect(ee.open_orders[0].origQty).bignumber.to.equal('0.5');
				});
			});
			it('creates a buy order when base_amount_to_buy is specified', async function() {
				const base_amount_to_buy = BigNumber(1);
				const limit_price = BigNumber(1);
				let { ee, algo } = setup({
					algo_config: {
						base_amount_to_buy,
						buy_price: limit_price
					}
				});
				try {
					await algo.main();
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.buyOrderId).to.equal(1);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(limit_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);
			});
			it('sends a message when the trade fills/partial fills');
		});
		describe('with soft_entry', function() {
			it('Creates a buy order when the price is within a percentage of the buy price');
			describe('when base_amount_to_buy is supplied', function() {
				it('only creates a buy order when entry price is hit', async function() {
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					let { ee, algo } = setup({
						algo_config: {
							base_amount_to_buy,
							buy_price,
							soft_entry: true
						}
					});
					try {
						await algo.main();
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(ee.open_orders).to.have.lengthOf(0);
					try {
						await ee.set_current_price({ symbol: default_pair, price: buy_price });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.buyOrderId).to.equal(1);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].orderId).to.equal(1);
					expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);
				});
				it('creates a buy order when entry price is percentage_before_soft_buy_price_to_add_order', async function() {
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(100);
					let percentage_before_soft_buy_price_to_add_order = BigNumber('0.5');
					// let expected_trigger_price = BigNumber('100.5');
					let { ee, algo } = setup({
						algo_config: {
							base_amount_to_buy,
							buy_price,
							soft_entry: true,
							percentage_before_soft_buy_price_to_add_order
						},
						ee_config: {
							starting_quote_balance: 100
						},
						no_agitate: true
					});
					try {
						await algo.main();
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(ee.open_orders).to.have.lengthOf(0);
					try {
						await ee.set_current_price({ symbol: default_pair, price: BigNumber('100.4') });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.buyOrderId).to.equal(1);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].orderId).to.equal(1);
					expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);
				});
			});
		});
	});

	describe('when only a buy_price and a stop_price present', function() {
		describe('with soft_entry', function() {
			// the code assumed if(soft_entry) then target_price was assumed to be defined
			it('doesnt error from assuming a target_price is specified (regression test');
		});
		it('doesnt buy if price is below the stop_price');
		it('responds appropriately if the exchange rejects the stop order because it would execute immediately');
		it('tests that the limit price is being munged if calculated by algo (regression test)');
		describe('when base_amount_to_buy is supplied', function() {
			it('creates a stop limit sell order after the buy order hits', async function() {
				const base_amount_to_buy = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.div(2);
				let { ee, algo } = setup({
					algo_config: {
						base_amount_to_buy,
						buy_price,
						stop_price
					}
				});
				try {
					await algo.main();
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.buyOrderId).to.equal(1);

				try {
					await ee.set_current_price({ symbol: default_pair, price: buy_price });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.buyOrderId).to.be.undefined;
				expect(algo.stopOrderId).to.equal(2);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price).bignumber.to.equal(stop_price.times(default_stop_limt_price_factor));
				expect(ee.open_orders[0].stopPrice).bignumber.to.equal(stop_price);
				expect(ee.open_orders[0].origQty).bignumber.to.equal(base_amount_to_buy);
			});
		});
		it('VERY IMPORTANT has been updated to have stop order with limit price of zero or market orders');
		it('buys using the available quote if it it less than the max specified', async function() {
			const buy_price = BigNumber(1);
			const stop_price = buy_price.div(2);
			let { ee, algo } = setup({
				algo_config: {
					buy_price,
					stop_price,
					max_quote_amount_to_buy: BigNumber(1)
				},
				ee_config: {
					starting_quote_balance: BigNumber('0.5')
				}
			});
			try {
				await algo.main();
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(algo.buyOrderId).to.equal(1);
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('BUY');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
			expect(ee.open_orders[0].origQty).bignumber.to.equal('0.5');
		});
	});
	describe('when only a buy_price and a target_price present', function() {
		describe('when base_amount_to_buy is supplied', function() {
			it('creates a limit sell order after the buy order hits', async function() {
				const base_amount_to_buy = BigNumber(1);
				const buy_price = BigNumber(1);
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						base_amount_to_buy,
						buy_price,
						target_price
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buy_price });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.targetOrderId).to.equal(2);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);
			});
		});
	});

	describe('when only a stop_price present', function() {
		it('WARNING: the ONLY test I had that stop losses were working is the one that checks sent_message!');
		it('Filters for "Filter failure: PERCENT_PRICE" so that it fails fast instead of when setting stop');
		// { Error: Order would trigger immediately.
		// 	at /Users/ryan/Dropbox/crypto/binance-tool/node_modules/binance-api-node/dist/http.js:51:19
		// 	at processTicksAndRejections (internal/process/next_tick.js:81:5)
		//   actual_name: 'AsyncErrorWrapper',
		//   name: 'Error',
		//   wrapped: true,
		//   message:
		//    '[AsyncErrorWrapper of Error] Order would trigger immediately.' }
		it('deals with the fact that Binance rejects STOP_LOSS_LIMIT_ORDERS that would trigger immediately');

		describe('when base_amount_held is supplied', function() {
			it('creates a stop order', async function() {
				const base_amount_held = BigNumber(1);
				const stop_price = BigNumber('0.5');
				let { ee, algo } = setup({
					ee_config: {
						starting_base_balance: BigNumber(1)
					},
					algo_config: {
						base_amount_held,
						stop_price
					}
				});
				try {
					await algo.main();
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.stopOrderId).to.equal(1);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price).to.bignumber.equal(stop_price.times(default_stop_limt_price_factor));
				expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_amount_held)).to.equal(true);
			});
		});
	});
	describe('when only a target_price present', function() {
		describe('when base_amount_held is supplied', function() {
			it('creates a limit sell order and returns', async function() {
				const base_amount_held = BigNumber(1);
				const target_price = BigNumber('2');
				let { ee, algo } = setup({
					ee_config: {
						starting_base_balance: base_amount_held
					},
					algo_config: {
						base_amount_held,
						target_price
					}
				});
				try {
					await algo.main();
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(algo.targetOrderId).to.equal(1);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_amount_held)).to.equal(true);
			});

			it('sends a message when the target_price is hit (currently only notifies when order is filled)');
		});
	});
	describe('when only a stop_price and a target_price present', function() {
		// The order is already in the books for the stop
		describe('when base_amount_held is supplied', function() {
			it('sends a message when the stop_price is hit (currently only notifies when order is placed/filled)', async function() {
				const base_amount_held = BigNumber(1);
				const stop_price = BigNumber('0.5');
				const target_price = BigNumber(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						base_amount_held,
						target_price,
						stop_price,
						logger
					},
					ee_config: { starting_base_balance: base_amount_held, logger }
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: stop_price });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(message_queue).to.include(`${default_pair} stop price hit`);
			});
			it('sends a message when the target_price is hit (currently only notifies when order is placed/filled)', async function() {
				const base_amount_held = BigNumber(1);
				const stop_price = BigNumber('0.5');
				const target_price = BigNumber(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						base_amount_held,
						target_price,
						stop_price
					},
					ee_config: { starting_base_balance: base_amount_held, logger }
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: target_price });
					console.log(message_queue);
				} catch (e) {
					expect.fail('should not get here: expected call not to throw');
				}
				expect(message_queue).to.include(`${default_pair} target price hit`);
			});
		});
		it('switches from stop to target a percentage before the actual price is hit');
		it('switches from target to stop a percentage before the actual price is hit');
		it('switches back and forth from stop and target as the price moves');
	});

	describe('when a buy_price and an base_amount_to_buy are present (-b and -a)', function() {
		it('handles -b 0 and -a 100');
		it('handles -b 100 and -a 100');
	});
	describe('when a buy_price, stop_price and target_price present', function() {
		it(
			'if it hits target price while buyOrder is still open then it cancels buy and places targetOrder if partially filled'
		);
		it('what happens if I get a partial stop fill then hit target? base_amount_to_buy needs to be dynamic, right?');
		describe('without soft entry', function() {
			describe('when base_amount_to_buy is supplied', function() {
				it('creates a stop limit sell order after the buy order hits', async function() {
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					const stop_price = buy_price.times('0.5');
					const target_price = buy_price.times(2);
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							base_amount_to_buy,
							buy_price,
							target_price,
							stop_price
						}
					});
					try {
						await algo.main();
						await ee.set_current_price({ symbol: default_pair, price: buy_price });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					let limit_price = stop_price.times(default_stop_limt_price_factor);
					expect(algo.stopOrderId).to.equal(2);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
					expect(ee.open_orders[0].side).to.equal('SELL');
					expect(ee.open_orders[0].orderId).to.equal(2);
					expect(ee.open_orders[0].price).to.bignumber.equal(limit_price);
					expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);

					try {
						await ee.set_current_price({ symbol: default_pair, price: stop_price }); // trigger setting of stop
						await ee.set_current_price({ symbol: default_pair, price: limit_price }); // fill stop order
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.be.an('string');
					expect(most_recent_message()).to.equal(`${default_pair} stop loss order filled`);
				});
				it('creates a limit sell order at the target_price when that price is hit', async function() {
					// TODO: also check that it cancels the stop order?
					// TODO: Sends a message?
					// TODO: what if we retrace to the stop price before the order is filled?
					// TODO: what if the target_price limit order gets partially filled and then we retrace to the stop price?
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					const stop_price = buy_price.times('0.5');
					const target_price = buy_price.times(2);
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							base_amount_to_buy,
							buy_price,
							target_price,
							stop_price
						}
					});
					try {
						await algo.main();
						await ee.set_current_price({ symbol: default_pair, price: buy_price });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.be.an('string');
					expect(most_recent_message()).to.equal(`${default_pair} buy order filled`);

					try {
						// Note that as part of hitting the target_price the algo will cancel the stopOrder,
						// which involves an await, hence why we await on set_current_price
						await ee.set_current_price({ symbol: default_pair, price: target_price });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.stoptOrderId).to.be.undefined;
					expect(algo.targetOrderId).to.equal(3);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('SELL');
					expect(ee.open_orders[0].orderId).to.equal(3);
					expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);

					try {
						await ee.set_current_price({ symbol: default_pair, price: target_price }); // a second time to trigger the LIMIT SELL
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.equal(`${default_pair} target sell order filled`);
				});
			});
			it('creates a stop order again when price moves from target price back to stop price');
		});
		describe('with soft entry', function() {
			it('doesnt buy if price is below the stop_price');
			describe('when base_amount_to_buy is supplied', function() {
				it('creates a limit buy order only after the buy price hits', async function() {
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					const stop_price = buy_price.times('0.5');
					const target_price = buy_price.times(2);
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							base_amount_to_buy,
							buy_price,
							target_price,
							stop_price,
							soft_entry: true
						}
					});
					try {
						await algo.main();
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(ee.open_orders).to.have.lengthOf(0);

					try {
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // once to trigger soft entry
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.buyOrderId).to.equal(1);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].orderId).to.equal(1);
					expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);
					expect(most_recent_message()).to.be.an('string');
					expect(most_recent_message()).to.equal(`${default_pair} soft entry buy order trigger price hit`);
				});

				it('creates a stop limit sell order after the buy order hits, and sends a message when the stop fills', async function() {
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					const stop_price = buy_price.times('0.5');
					const target_price = buy_price.times(2);
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							base_amount_to_buy,
							buy_price,
							target_price,
							stop_price,
							soft_entry: true
						}
					});
					try {
						await algo.main();
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // once to trigger soft entry
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // twice to fill order
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.stopOrderId).to.equal(2);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
					expect(ee.open_orders[0].side).to.equal('SELL');
					expect(ee.open_orders[0].orderId).to.equal(2);
					expect(ee.open_orders[0].price).to.bignumber.equal(
						stop_price.times(default_stop_limt_price_factor)
					);
					expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);

					let limit_price = stop_price.times(default_stop_limt_price_factor);
					try {
						await ee.set_current_price({ symbol: default_pair, price: stop_price }); // trigger stop creation
						await ee.set_current_price({ symbol: default_pair, price: limit_price }); // fill stop order
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.be.an('string');
					expect(most_recent_message()).to.equal(`${default_pair} stop loss order filled`);
				});
				it('creates a limit sell order at the target_price when that price is hit', async function() {
					// TODO: also check that it cancels the stop order?
					// TODO: Sends a message?
					// TODO: what if we retrace to the stop price before the order is filled?
					// TODO: what if the target_price limit order gets partially filled and then we retrace to the stop price?
					const base_amount_to_buy = BigNumber(1);
					const buy_price = BigNumber(1);
					const stop_price = buy_price.times('0.5');
					const target_price = buy_price.times(2);
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							base_amount_to_buy,
							buy_price,
							target_price,
							stop_price,
							soft_entry: true
						}
					});
					try {
						await algo.main();
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // once to trigger soft entry
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // twice to fill order
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.be.an('string');
					expect(most_recent_message()).to.equal(`${default_pair} buy order filled`);

					try {
						// Note that as part of hitting the target_price the algo will cancel the stopOrder,
						// which involves an await, hence why we await on set_current_price
						await ee.set_current_price({ symbol: default_pair, price: target_price });
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(algo.targetOrderId).to.equal(3);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('SELL');
					expect(ee.open_orders[0].orderId).to.equal(3);
					expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
					expect(ee.open_orders[0].origQty.isEqualTo(base_amount_to_buy)).to.equal(true);

					try {
						await ee.set_current_price({ symbol: default_pair, price: target_price }); // a second time to trigger the LIMIT SELL
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					expect(most_recent_message()).to.equal(`${default_pair} target sell order filled`);
				});
			});
		});
	});

	describe('soft entry', function() {
		it('sends a message if a soft entry hits the buy price but there are insufficient funds to execute it');
		it('auto calculates the max base_amount_to_buy based on portfolio value and stop_percentage');
		it('buys as much as it can if there are insufficient funds to buy the requested base_amount_to_buy');
		it(
			'watches the user stream for freed up capital and if allocation still available and price between buy-stop_price it buys more'
		);
	});
	describe('auto-size', function() {
		// needs buy_price, stop_price, trading_rules. soft_entry?
		it('throws an error in the constructor if it doesnt have the information it needs to auto-size');
		it('knows something about trading fees and if that affects the base_amount_to_buy if there isnt enough BNB');
		it('buys the full base_amount_to_buy when -q is specified without --auto-size');
		it(
			'does what when -a is specified --auto-size? on a buy? on a sell? -a with no args to manage whatever base balance we have?'
		);
		describe('works when buying spot (market buy mode)', function() {
			describe('when only auto_size is supplied (no base_amount_to_buy or quote_amount)', function() {
				it('creates market buy order for the max base_amount to buy based on current_price, portfolio value and stop_percentage', async function() {
					const marketPrice = BigNumber(1);
					const stop_price = marketPrice.times('0.98');
					const trading_rules = {
						max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
					};
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							buy_price: BigNumber('0'),
							stop_price,
							trading_rules,
							auto_size: true
						},
						ee_config: {
							starting_quote_balance: BigNumber(1)
						},
						no_agitate: true
					});
					try {
						await ee.set_current_price({ symbol: default_pair, price: marketPrice });
						await algo.main();
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					// check for a buy order placed at an appropriate size: 2% stop and 1% max loss => 50% of portfolio
					// it's a market buy - are these emulated yet? Not in order book perhaps iirc
					expect(algo.buyOrderId).to.equal(1);
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('MARKET');
					expect(ee.open_orders[0].side).to.equal('BUY');
					expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
				});
			});
			it('prints the result when the order completes. I think maybe we are not setting order id atm');
			it('creates the stop order after the market buy is completed (currently doesnt)');
		});

		describe('without soft_entry', function() {
			it('creates buy order for the max base_amount to buy based on portfolio value and stop_percentage', async function() {
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.98');
				const trading_rules = {
					max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
				};
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						buy_price,
						stop_price,
						trading_rules,
						auto_size: true
					},
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
				expect(algo.buyOrderId).to.equal(1);
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
				expect(ee.open_orders[0].price).to.bignumber.equal(buy_price);
			});
		});

		describe('with soft_entry', function() {
			it('creates buy order for the max base_amount to buy based on portfolio value and stop_percentage', async function() {
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.98');
				const trading_rules = {
					max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
				};
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						buy_price,
						stop_price,
						trading_rules,
						soft_entry: true,
						auto_size: true
					},
					ee_config: {
						starting_quote_balance: BigNumber(1)
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buy_price }); // once to trigger soft entry
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				// check for a buy order placed at an appropriate size: 2% stop and 1% max loss => 50% of portfolio
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
			});
			describe('with base balances too (hack: using default base currency)', function() {
				it('calculates the max base_amount to buy based on portfolio value and stop_percentage', async function() {
					const buy_price = BigNumber(4);
					const stop_price = buy_price.times('0.96');
					const trading_rules = {
						max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
					};
					let { ee, algo } = setup({
						algo_config: {
							pair: default_pair,
							buy_price,
							stop_price,
							trading_rules,
							soft_entry: true,
							auto_size: true
						},
						ee_config: {
							starting_quote_balance: BigNumber(20),
							starting_base_balance: BigNumber(10) // where exchange has an ETHBTC pair
							// TODO: add another pairing rather than the default_pair. NB needs EE refactor
						}
					});
					try {
						await algo.main();
						await ee.set_current_price({ symbol: default_pair, price: buy_price }); // once to trigger soft entry
					} catch (e) {
						console.log(e);
						expect.fail('should not get here: expected call not to throw');
					}
					// check for a buy order placed at an appropriate size: 4% stop and 1% max loss => 25% of portfolio
					// Base value is 4 * 10 = 40, plus 20 quote = 60. 25% of 60 is 15. So, less than available quote.
					expect(ee.open_orders).to.have.lengthOf(1);
					expect(ee.open_orders[0].type).to.equal('LIMIT');
					expect(ee.open_orders[0].side).to.equal('BUY');
					let base_quantity = BigNumber(15).dividedBy(buy_price);
					expect(ee.open_orders[0].origQty).to.bignumber.equal(base_quantity);
				});
			});
		});
		it('handles attempted trades below the min notional cleanly');
	});

	/// i.e. when stacking commands to emulate a range trading bot
	// if the first commend got stopped out I don't want to be immediately ordering a buy
	// at the next level. Can make a stop out exit with a non-zero code
	it(
		'maybe: invalidates a trade if the price is below the stop price at startup. Or it waits for the buy price to recover?'
	);
	it('can handle partial fills range trading');
	describe('Persistance / restartability)', function() {
		it('tracks state for trades so it can be restarted');
		it('can adopt a certain base_amount of existing base currency into a trade');
	});

	it(
		'add tests for autosize and setting stop and target orders to verifty munging is happening and being checked for'
	);
	it('handles getting unexpected insufficient balance errors');
	it('when auto-size is not specified we can buy more than the trading rules would allow');
	it('should autosize automatically and only ignore trading rules if --ignore-trading-rules is set');

	describe('Selling (vs stop))', function() {
		it('can calculate the base_amount to sell to reduce a position by a quote_amount at spot');
	});
	it('adds more capital to a trade if capital becomes available while still in the buy-stop zone');
	it('exits without trading if percentages is passed');
});
