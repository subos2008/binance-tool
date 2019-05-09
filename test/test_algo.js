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

describe('Algo', function() {
	function setup({ algo_config, ee_config } = {}) {
		ee_config = Object.assign(
			{ logger: null_logger, exchange_info, starting_quote_balance: BigNumber(1) },
			ee_config
		);
		let ee = new ExchangeEmulator(ee_config);
		algo_config = Object.assign({ logger: null_logger, send_message: fresh_message_queue() }, algo_config);
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
		describe('without soft_entry', function() {
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
			it('sends a message when the trade fills/partial fills');
		});
		describe('with soft_entry', function() {
			it('only creates a buy order when entry price is hit', async function() {
				const base_volume = BigNumber(1);
				const buyPrice = BigNumber(1);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount: base_volume,
						buyPrice,
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
					await ee.set_current_price({ symbol: default_pair, price: buyPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(buyPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(base_volume)).to.equal(true);
			});
		});
	});

	describe('when only a buyPrice and a stopPrice present', function() {
		it('creates a stop limit sell order after the buy order hits', async function() {
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
				await ee.set_current_price({ symbol: default_pair, price: buyPrice });
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
	describe('when only a buyPrice and a targetPrice present', function() {
		it('creates a limit sell order after the buy order hits', async function() {
			const amount = BigNumber(1);
			const buyPrice = BigNumber(1);
			const targetPrice = buyPrice.times(2);
			let { ee, algo } = setup({
				algo_config: {
					pair: default_pair,
					amount,
					buyPrice,
					targetPrice
				}
			});
			try {
				await algo.main();
				await ee.set_current_price({ symbol: default_pair, price: buyPrice });
			} catch (e) {
				console.log(e);
				expect.fail('should not get here: expected call not to throw');
			}
			expect(ee.open_orders).to.have.lengthOf(1);
			expect(ee.open_orders[0].type).to.equal('LIMIT');
			expect(ee.open_orders[0].side).to.equal('SELL');
			expect(ee.open_orders[0].orderId).to.equal(2);
			expect(ee.open_orders[0].price.isEqualTo(targetPrice)).to.equal(true);
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
			expect(ee.open_orders[0].stopPrice.isEqualTo(stopPrice)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when only a targetPrice present', function() {
		it('creates a limit sell order and returns', async function() {
			const amount = BigNumber(1);
			const targetPrice = BigNumber('2');
			let { ee, algo } = setup({
				ee_config: {
					starting_base_balance: amount
				},
				algo_config: {
					pair: default_pair,
					amount,
					targetPrice
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
			expect(ee.open_orders[0].price.isEqualTo(targetPrice)).to.equal(true);
			expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
		});
	});
	describe('when a buyPrice, stopPrice and targetPrice present', function() {
		describe('without soft entry', function() {
			it('creates a stop limit sell order after the buy order hits', async function() {
				const amount = BigNumber(1);
				const buyPrice = BigNumber(1);
				const stopPrice = buyPrice.times('0.5');
				const targetPrice = buyPrice.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
						buyPrice,
						targetPrice,
						stopPrice
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buyPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price.isEqualTo(stopPrice)).to.equal(true);
				expect(ee.open_orders[0].stopPrice.isEqualTo(stopPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: stopPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} stop loss order filled`);
			});
			it('creates a limit sell order at the targetPrice when that price is hit', async function() {
				// TODO: also check that it cancels the stop order?
				// TODO: Sends a message?
				// TODO: what if we retrace to the stop price before the order is filled?
				// TODO: what if the targetPrice limit order gets partially filled and then we retrace to the stop price?
				const amount = BigNumber(1);
				const buyPrice = BigNumber(1);
				const stopPrice = buyPrice.times('0.5');
				const targetPrice = buyPrice.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
						buyPrice,
						targetPrice,
						stopPrice
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buyPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} buy order filled`);

				try {
					// Note that as part of hitting the targetPrice the algo will cancel the stopOrder,
					// which involves an await, hence why we await on set_current_price
					await ee.set_current_price({ symbol: default_pair, price: targetPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(3);
				expect(ee.open_orders[0].price.isEqualTo(targetPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: targetPrice }); // a second time to trigger the LIMIT SELL
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.equal(`${default_pair} target sell order filled`);
			});
		});
		describe('with soft entry', function() {
			it('creates a limit buy order only after the buy price hits', async function() {
				const amount = BigNumber(1);
				const buyPrice = BigNumber(1);
				const stopPrice = buyPrice.times('0.5');
				const targetPrice = buyPrice.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
						buyPrice,
						targetPrice,
						stopPrice,
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
					await ee.set_current_price({ symbol: default_pair, price: buyPrice }); // once to trigger soft entry
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('BUY');
				expect(ee.open_orders[0].orderId).to.equal(1);
				expect(ee.open_orders[0].price.isEqualTo(buyPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} soft entry buy price hit`);
			});

			it('creates a stop limit sell order after the buy order hits', async function() {
				const amount = BigNumber(1);
				const buyPrice = BigNumber(1);
				const stopPrice = buyPrice.times('0.5');
				const targetPrice = buyPrice.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
						buyPrice,
						targetPrice,
						stopPrice,
						soft_entry: true
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buyPrice }); // once to trigger soft entry
					await ee.set_current_price({ symbol: default_pair, price: buyPrice }); // twice to fill order
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('STOP_LOSS_LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(2);
				expect(ee.open_orders[0].price.isEqualTo(stopPrice)).to.equal(true);
				expect(ee.open_orders[0].stopPrice.isEqualTo(stopPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: stopPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} stop loss order filled`);
			});
			it('creates a limit sell order at the targetPrice when that price is hit', async function() {
				// TODO: also check that it cancels the stop order?
				// TODO: Sends a message?
				// TODO: what if we retrace to the stop price before the order is filled?
				// TODO: what if the targetPrice limit order gets partially filled and then we retrace to the stop price?
				const amount = BigNumber(1);
				const buyPrice = BigNumber(1);
				const stopPrice = buyPrice.times('0.5');
				const targetPrice = buyPrice.times(2);
				let { ee, algo } = setup({
					algo_config: {
						pair: default_pair,
						amount,
						buyPrice,
						targetPrice,
						stopPrice,
						soft_entry: true
					}
				});
				try {
					await algo.main();
					await ee.set_current_price({ symbol: default_pair, price: buyPrice }); // once to trigger soft entry
					await ee.set_current_price({ symbol: default_pair, price: buyPrice }); // twice to fill order
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.be.an('string');
				expect(most_recent_message()).to.equal(`${default_pair} buy order filled`);

				try {
					// Note that as part of hitting the targetPrice the algo will cancel the stopOrder,
					// which involves an await, hence why we await on set_current_price
					await ee.set_current_price({ symbol: default_pair, price: targetPrice });
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(ee.open_orders).to.have.lengthOf(1);
				expect(ee.open_orders[0].type).to.equal('LIMIT');
				expect(ee.open_orders[0].side).to.equal('SELL');
				expect(ee.open_orders[0].orderId).to.equal(3);
				expect(ee.open_orders[0].price.isEqualTo(targetPrice)).to.equal(true);
				expect(ee.open_orders[0].origQty.isEqualTo(amount)).to.equal(true);

				try {
					await ee.set_current_price({ symbol: default_pair, price: targetPrice }); // a second time to trigger the LIMIT SELL
				} catch (e) {
					console.log(e);
					expect.fail('should not get here: expected call not to throw');
				}
				expect(most_recent_message()).to.equal(`${default_pair} target sell order filled`);
			});
		});
	});
	describe('soft entry', function() {
		it('sends a message if a soft entry hits the buy price but there are insufficient funds to execute it');
		it('auto calculates the max amount to buy based on portfolio value and stop_percentage');
		it('buys as much as it can if there are insufficient funds to buy the requested amount');
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
});
