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

const default_base_currency = 'ETH';
const default_quote_currency = 'BTC';
const default_pair = `${default_base_currency}${default_quote_currency}`;
const exchange_info = JSON.parse(fs.readFileSync('./test/exchange_info.json', 'utf8'));

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
	return BigNumber(price).plus('.0000001'); // will trigger the PRICE_FILTER unless prices are munged
}
function aggrivate_amount(amount) {
	return BigNumber(amount).plus('.0001'); // will trigger the LOT_SIZE unless amount is munged
}

describe('Algo', function() {
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
		algo_config = Object.assign({ ee, logger: null_logger, send_message: fresh_message_queue() }, algo_config);
		if (!algo_config.pair && !algo_config.virtualPair) {
			algo_config.pair = default_pair;
		}
		if (!no_agitate) {
			if (algo_config.buy_price) algo_config.buy_price = aggrivate_price(algo_config.buy_price);
			if (algo_config.stop_price) algo_config.stop_price = aggrivate_price(algo_config.stop_price);
			if (algo_config.target_price) algo_config.target_price = aggrivate_price(algo_config.target_price);
			// TODO: add some tests with limit_price
			if (algo_config.limit_price) algo_config.limit_price = aggrivate_price(algo_config.limit_price);
			if (algo_config.amount) algo_config.amount = aggrivate_amount(algo_config.amount);
		}
		let algo = new Algo(algo_config);
		return { algo, ee };
	}

	describe('constructor', function() {
		it.skip('does some stuff', function() {
			// let ee = setup_ee();
			// expect(ee.quote_coin_balance_not_in_orders.isEqualTo(starting_quote_balance)).to.equal(true);
		});
	});

	describe('when only a buy_price is present', function() {
		describe('without soft_entry', function() {
			it('creates a buy order and returns', async function() {
				const base_volume = BigNumber(1);
				const limit_price = BigNumber(1);
				let { ee, algo } = setup({
					algo_config: {
						amount: base_volume,
						buy_price: limit_price
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
			it('sends a message when the trade fills/partial fills');
		});
		describe('with soft_entry', function() {
			it('only creates a buy order when entry price is hit', async function() {
				const base_volume = BigNumber(1);
				const buy_price = BigNumber(1);
				let { ee, algo } = setup({
					algo_config: {
						amount: base_volume,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
		});
	});

	describe('when only a buy_price and a stop_price present', function() {
		describe('with soft_entry', function() {
			// the code assumed if(soft_entry) then target_price was assumed to be defined
			it('doesnt error from assuming a target_price is specified');
		});
		it('doesnt buy if price is below the stop_price');

		it('creates a stop limit sell order after the buy order hits', async function() {
			const amount = BigNumber(1);
			const buy_price = BigNumber(1);
			const stop_price = buy_price.div(2);
			let { ee, algo } = setup({
				algo_config: {
					amount,
					buy_price,
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
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(2);
			expect(ee.open_orders[0].price.isEqualTo(stop_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when only a buy_price and a target_price present', function() {
		it('creates a limit sell order after the buy order hits', async function() {
			const amount = BigNumber(1);
			const buy_price = BigNumber(1);
			const target_price = buy_price.times(2);
			let { ee, algo } = setup({
				algo_config: {
					amount,
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
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(2);
			expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});

	describe('when only a stop_price present', function() {
		it('creates a stop order and returns', async function() {
			const amount = BigNumber(1);
			const stop_price = BigNumber('0.5');
			let { ee, algo } = setup({
				ee_config: {
					starting_base_balance: BigNumber(1)
				},
				algo_config: {
					amount,
					stop_price
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
			expect(ee.open_orders[0].price.isEqualTo(stop_price)).to.equal(true);
			expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when only a target_price present', function() {
		it('creates a limit sell order and returns', async function() {
			const amount = BigNumber(1);
			const target_price = BigNumber('2');
			let { ee, algo } = setup({
				ee_config: {
					starting_base_balance: amount
				},
				algo_config: {
					amount,
					target_price
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
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(1);
			expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when a buy_price, stop_price and target_price present', function() {
		it(
			'if it hits target price while buyOrder is still open then it cancels buy and places targetOrder if partially filled'
		);
		it('what happens if I get a partial stop fill then hit target? amount needs to be dynamic, right?');
		describe('without soft entry', function() {
			it('creates a stop limit sell order after the buy order hits', async function() {
				const amount = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.5');
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price.isEqualTo(stop_price)).to.equal(true);
				expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: stop_price });
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
				const amount = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.5');
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(3);
				expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: target_price }); // a second time to trigger the LIMIT SELL
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.equal(`${default_pair} target sell order filled`);
			});
		});
		describe('with soft entry', function() {
			it('doesnt buy if price is below the stop_price');
			it('creates a limit buy order only after the buy price hits', async function() {
				const amount = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.5');
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(buy_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} soft entry buy price hit`);
			});

			it('creates a stop limit sell order after the buy order hits', async function() {
				const amount = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.5');
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price.isEqualTo(stop_price)).to.equal(true);
				expect(ee.open_orders[0].stopPrice.isEqualTo(stop_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: stop_price });
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
				const amount = BigNumber(1);
				const buy_price = BigNumber(1);
				const stop_price = buy_price.times('0.5');
				const target_price = buy_price.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(3);
				expect(ee.open_orders[0].price.isEqualTo(target_price)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

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

	describe('_get_portfolio_value_from_exchange', function() {
		it('when only quote currency held: returns the total amount of quote currency held', async function() {
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					soft_entry: true,
					auto_size: true
				},
				ee_config: {
					starting_quote_balance: BigNumber(200)
				}
			});
			let response = await algo._get_portfolio_value_from_exchange({ quote_currency: default_quote_currency });
			expect(response).to.have.property('total');
			expect(response.total).to.bignumber.equal(200);
			expect(response.available).to.bignumber.equal(200);
		});
		it('when only default base currency held: returns the equvalent amount of quote currency held', async function() {
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					soft_entry: true,
					auto_size: true
				},
				ee_config: {
					starting_quote_balance: BigNumber(0),
					starting_base_balance: BigNumber(201)
				}
			});
			let response;
			try {
				await ee.set_current_price({ symbol: default_pair, price: BigNumber('0.5') });
				response = await algo._get_portfolio_value_from_exchange({
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
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					soft_entry: true,
					auto_size: true
				},
				ee_config: {
					starting_quote_balance: BigNumber(2),
					starting_base_balance: BigNumber(201)
				}
			});
			let response;
			try {
				await ee.set_current_price({ symbol: default_pair, price: BigNumber('0.5') });
				response = await algo._get_portfolio_value_from_exchange({
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

	describe('soft entry', function() {
		it('sends a message if a soft entry hits the buy price but there are insufficient funds to execute it');
		it('auto calculates the max amount to buy based on portfolio value and stop_percentage');
		it('buys as much as it can if there are insufficient funds to buy the requested amount');
		it(
			'watches the user stream for freed up capital and if allocation still available and price between buy-stop_price it buys more'
		);
	});
	describe('auto-size', function() {
		// needs buy_price, stop_price, trading_rules. soft_entry?
		it('throws an error in the constructor if it doesnt have the information it needs to auto-size');
		it('knows something about trading fees and if that affects the amount if there isnt enough BNB');
		describe('works when buying spot (market buy mode)', function() {
			it('creates market buy order for the max amount to buy based on current_price, portfolio value and stop_percentage', async function() {
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
						auto_size: true,
						logger
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('MARKET');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
				expect(ee.open_orders[0].price).to.bignumber.equal(buy_price);
			});
		});

		describe('without soft_entry', function() {
			it('creates buy order for the max amount to buy based on portfolio value and stop_percentage', async function() {
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
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].origQty).to.bignumber.equal('0.5');
				expect(ee.open_orders[0].price).to.bignumber.equal(buy_price);
			});
		});

		describe('with soft_entry', function() {
			it('creates buy order for the max amount to buy based on portfolio value and stop_percentage', async function() {
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
				it('calculates the max amount to buy based on portfolio value and stop_percentage', async function() {
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
	it('can track multiple trades and move funds into those with the best r/r');
	it('auto sells a percentage at 5% and 10%');
	it(
		"has a last-revalidated date that it checks on startup and won't enter trades that haven't been manually re-validated recently"
	);
	it('tracks state for trades so it can be restarted');
	it('can handle partial fills range trading');
	it('can adopt a certain amount of existing base currency into a trade');
	it(
		'add tests for autosize and setting stop and target orders to verifty munging is happening and being checked for'
	);
});
