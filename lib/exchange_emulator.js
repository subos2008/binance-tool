// You might call this a mock: an offline version
// exchangeable with the ExecutionEngine
// Hence them being stored in a varaible called 'ee'

// see crypto-cluster/cli/execution-engine/lib/execution_engine.js
// for a more complete execution engine

// Emulates binance-api-node. WIP.

// TODO: note this code is on the cusp of migrating from the original assumption
// TODO: that is would be one pair per EE towards the new requirement that an EE
// TODO: can track and trade multiple pairs. For example setting the price takes
// TODO: a symbol but checks for hit orders don't currently use that symbol :-/

// TODO: if a limit order is added at the current price it won't immediately execute.
// This could be considered a bug or not

const BigNumber = require('bignumber.js');
const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);
const assert = require('assert');
const utils = require('../lib/utils');
const async_error_handler = require('../lib/async_error_handler');

const { OrderTooSmallError, InsufficientBalanceError } = require('./errors');
const { NotImplementedError } = require('./errors');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class ExchangeEmulator {
	constructor(
		{
			logger,
			starting_balances,
			starting_quote_balance,
			starting_base_balance,
			base_currency,
			quote_currency,
			exchange_info
		} = {}
	) {
		if (typeof starting_quote_balance === 'undefined') starting_quote_balance = BigNumber(0);
		assert(starting_quote_balance);
		assert(logger);
		this.logger = logger;
		this.exchange_info = exchange_info;
		assert(base_currency);
		assert(quote_currency);

		this.balances = {};

		if (base_currency && quote_currency) {
			this.base_currency = base_currency;
			this.quote_currency = quote_currency;
			assert(BigNumber.isBigNumber(starting_quote_balance));
			this._set_free_balance(this.quote_currency, starting_quote_balance);
			if (starting_base_balance) {
				assert(BigNumber.isBigNumber(starting_base_balance));
				this._set_free_balance(this.base_currency, starting_base_balance);
			}
		}

		// FIXME: urgh, null vs undefined etc... and we check for this
		// all over the place. Some kind of code smell.
		this.current_price = null;
		this.open_orders = [];
		this.completed_orders = [];
		this.cancelled_orders = [];
		this.next_order_id = 1;
		// binance-api-node API
		this.ws = { user: this.ws_user.bind(this), aggTrades: this.ws_agg_trades.bind(this) };
		this.known_prices = {};
		if (starting_balances) {
			Object.keys(starting_balances).forEach((asset) => {
				this.balances[asset] = { locked: BigNumber(0), free: BigNumber(starting_balances[asset]) };
			});
		}
	}

	_set_free_balance(currency, value) {
		assert(currency);
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		if (!(currency in this.balances)) this.balances[currency] = { locked: BigNumber(0) };
		this.balances[currency].free = value;
	}

	_set_locked_balance(currency, value) {
		assert(currency);
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		if (!(currency in this.balances)) this.balances[currency] = { free: BigNumber(0) };
		this.balances[currency].locked = value;
	}

	_lock_balance(currency, amount) {
		this._set_locked_balance(currency, this.balance_in_orders(currency).plus(amount));
		this._set_free_balance(currency, this.balance_not_in_orders(currency).minus(amount));
	}

	_unlock_balance(currency, amount) {
		this._set_locked_balance(currency, this.balance_in_orders(currency).minus(amount));
		this._set_free_balance(currency, this.balance_not_in_orders(currency).plus(amount));
	}

	// trades call this
	_exchange_balances_from_locked_to_free(from_currency, from_amount, to_currency, to_amount) {
		assert(from_currency);
		assert(to_currency);
		this._set_locked_balance(from_currency, this.balance_in_orders(from_currency).minus(from_amount));
		this._set_free_balance(to_currency, this.balance_not_in_orders(to_currency).plus(to_amount));
	}

	balance_not_in_orders(currency) {
		if (currency in this.balances) {
			return this.balances[currency].free;
		} else {
			return BigNumber(0);
		}
	}

	balance_in_orders(currency) {
		if (currency in this.balances) {
			return this.balances[currency].locked;
		} else {
			return BigNumber(0);
		}
	}

	// used by some tests
	get quote_coin_balance_in_orders() {
		return this.balance_in_orders(this.quote_currency);
	}

	// used by some tests
	get base_coin_balance_not_in_orders() {
		return this.balance_not_in_orders(this.base_currency);
	}

	// used by some tests
	get base_coin_balance_in_orders() {
		return this.balance_in_orders(this.base_currency);
	}

	// used by tests atm
	get quote_coin_balance_not_in_orders() {
		return this.balance_not_in_orders(this.quote_currency);
	}

	total_balance(currency) {
		return this.balance_in_orders(currency).plus(this.balance_not_in_orders(currency));
	}

	async set_current_price({ price, symbol } = {}) {
		assert(symbol);
		assert(BigNumber.isBigNumber(price));
		this.current_price = price;
		this.known_prices[symbol] = price;
		try {
			await this._check_for_completed_limit_orders({ price });
		} catch (e) {
			async_error_handler(this.logger, 'set_current_price when checking for completed limit orders:', e);
		}
		try {
			await this.send_ws_trades_events({ price, symbol });
		} catch (e) {
			async_error_handler(this.logger, 'set_current_price when sending ws trades events:', e);
		}
	}

	async add_limit_buy_order({ base_volume, limit_price, pair } = {}) {
		try {
			assert(BigNumber.isBigNumber(base_volume));
			assert(BigNumber.isBigNumber(limit_price));
			assert(base_volume.isGreaterThan(0));
			assert(limit_price.isGreaterThan(0));
			assert(pair);
			let quote_currency = utils.quote_currency_for_binance_pair(pair);
			const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: limit_price });
			if (this.balance_not_in_orders(quote_currency).isLessThan(quote_volume)) {
				throw new InsufficientBalanceError(
					`this.balance_not_in_orders(quote_currency) must be >= quote_volume: base_volume: ${base_volume}, limit_price: ${limit_price} balance_not_in_orders(quote_currency): ${this.balance_not_in_orders(
						quote_currency
					)}, quote_volume: ${quote_volume}`
				);
			}
			const id = this.next_order_id;
			this.next_order_id += 1;
			this.open_orders.push({
				origQty: base_volume,
				price: limit_price,
				type: 'LIMIT',
				side: 'BUY',
				symbol: pair,
				orderId: id
			});
			this._lock_balance(quote_currency, quote_volume);
			return { orderId: id };
		} catch (e) {
			async_error_handler(this.logger, `failed add_limit_buy_order`, e);
		}
	}

	split_pair(pair) {
		const [ total, base_currency, quote_currency ] = utils.break_up_binance_pair(pair);
		return {
			quote_currency,
			base_currency
		};
	}

	async add_limit_sell_order({ base_volume, limit_price, pair } = {}) {
		try {
			assert(BigNumber.isBigNumber(base_volume));
			assert(BigNumber.isBigNumber(limit_price));
			assert(base_volume.isGreaterThan(0));
			assert(limit_price.isGreaterThan(0)); // really?
			assert(pair);
			let { base_currency } = this.split_pair(pair);
			// TODO: throw InsufficientBalanceError  ... but really do whatever binance API does
			assert(
				this.balance_not_in_orders(base_currency).isGreaterThanOrEqualTo(base_volume),
				`this.balance_not_in_orders(${base_currency}) must be >= base_volume (${base_volume})`
			);
			const id = this.next_order_id;
			this.next_order_id += 1;
			this.open_orders.push({
				origQty: base_volume,
				price: limit_price,
				type: 'LIMIT',
				side: 'SELL',
				symbol: pair,
				orderId: id
			});
			this._lock_balance(base_currency, base_volume);
			return { orderId: id };
		} catch (e) {
			this.logger.error(
				`Error in add_limit_sell_order with args: base_volume: ${base_volume}, limit_price: ${limit_price}`
			);
			throw e;
		}
	}

	async add_stop_loss_limit_sell_order({ base_volume, price, stopPrice, pair } = {}) {
		try {
			assert(BigNumber.isBigNumber(base_volume));
			assert(BigNumber.isBigNumber(price));
			assert(BigNumber.isBigNumber(stopPrice));
			assert(base_volume.isGreaterThan(0));
			assert(price.isGreaterThan(0)); // really?
			assert(stopPrice.isGreaterThan(0));
			assert(pair);
		} catch (e) {
			this.logger.error(
				`Asserts failed in add_stop_loss_limit_sell_order with args: base_volume: ${base_volume}, price: ${price} stopPrice: ${stopPrice}`
			);
			throw e;
		}

		let { base_currency } = this.split_pair(pair);
		if (this.balance_not_in_orders(base_currency).isLessThan(base_volume)) {
			throw new InsufficientBalanceError(`this.balance_not_in_orders(${base_currency}) must be >= base_volume`);
		}

		const id = this.next_order_id;
		this.next_order_id += 1;
		this.open_orders.push({
			origQty: base_volume,
			price: price,
			stopPrice: stopPrice,
			type: 'STOP_LOSS_LIMIT',
			side: 'SELL',
			symbol: pair,
			orderId: id
		});
		this._lock_balance(base_currency, base_volume);
		return { orderId: id };
	}

	// TODO: fees
	_execute_hit_limit_sell({ order } = {}) {
		const base_volume = order['origQty'];
		const price = order['price'];
		assert(BigNumber.isBigNumber(base_volume));
		assert(BigNumber.isBigNumber(price));
		const quote_volume = base_volume.times(price);
		this._exchange_balances_from_locked_to_free(this.base_currency, base_volume, this.quote_currency, quote_volume);
		order.orderStatus = 'FILLED';
		this.completed_orders.push(order);
		this.logger.info(`Hit limit sell: sold ${base_volume} at ${price} for ${quote_volume}`);
		return order;
	}

	// TODO: fees
	_execute_hit_limit_buy({ order } = {}) {
		const base_volume = order['origQty'];
		const price = order['price'];
		assert(BigNumber.isBigNumber(base_volume));
		assert(BigNumber.isBigNumber(price));
		const quote_volume = base_volume.times(price);
		this._exchange_balances_from_locked_to_free(this.quote_currency, quote_volume, this.base_currency, base_volume);
		order.orderStatus = 'FILLED';
		this.completed_orders.push(order);
		this.logger.info(`Hit limit buy: bought ${base_volume} at ${price} for ${quote_volume}`);
		return order;
	}

	async _check_for_completed_limit_orders({ price } = {}) {
		assert(BigNumber.isBigNumber(price));
		var remaining_orders = [];
		var completed_orders = [];
		this.open_orders.forEach((order) => {
			if (price.isEqualTo(order['price'])) {
				// TODO: this does execute stop limit orders but ...
				if (order.side === 'SELL') {
					completed_orders.push(this._execute_hit_limit_sell({ order }));
				} else if (order.side === 'BUY') {
					completed_orders.push(this._execute_hit_limit_buy({ order }));
				} else {
					throw new Error('Unknown order type');
				}
			} else {
				remaining_orders.push(order);
			}
		});
		this.open_orders = remaining_orders;
		this.send_ws_events(completed_orders);
		return completed_orders;
	}

	//---------- END check_for_completed_limit_orders ---------------------

	// TODO: this should be namespaced to the traded pair
	async cancel_all_open_orders() {
		this.open_orders.forEach((order) => {
			const base_volume = order['origQty'];
			assert(order.type === 'LIMIT');
			if (order.side === 'BUY') {
				const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: order.price });
				this._unlock_balance(this.quote_currency, quote_volume);
			}
			if (order.side === 'SELL') {
				this._unlock_balance(this.base_currency, base_volume);
			}
		});
		this.cancelled_orders = this.cancelled_orders.concat(this.open_orders);
		// TODO: send event to .ws.user
		this.open_orders = [];
	}

	// API for binance-api-node
	async exchangeInfo() {
		return this.exchange_info;
	}

	async order({ side, symbol, type, quantity, price, stopPrice } = {}) {
		if (typeof price !== 'undefined') {
			// TODO: should check stopPrice too?
			let munged_price = utils.munge_and_check_price({ price, exchange_info: this.exchange_info, symbol });
			if (!BigNumber(price).isEqualTo(munged_price)) {
				throw new Error(`.order passed unmunged price: PRICE_FILTER`); // TODO make this match the binance error
			}
		}
		if (typeof quantity !== 'undefined') {
			let munged_volume = utils.munge_and_check_quantity({
				volume: quantity,
				exchange_info: this.exchange_info,
				symbol
			});
			if (!BigNumber(munged_volume).isEqualTo(quantity)) {
				throw new Error(`.order passed unmunged quantity: LOT_SIZE`); // TODO make this match the binance error
			}
		}
		if (typeof quantity !== 'undefined' && typeof price !== 'undefined') {
			// TODO: should check value at stopPrice too?
			utils.check_notional({
				volume: quantity,
				price,
				exchange_info: this.exchange_info,
				symbol
			});
		}
		if (type === 'LIMIT') {
			if (side === 'BUY') {
				return await this.add_limit_buy_order({
					base_volume: BigNumber(quantity),
					limit_price: BigNumber(price),
					pair: symbol
				});
			} else if (side === 'SELL') {
				return await this.add_limit_sell_order({
					base_volume: BigNumber(quantity),
					limit_price: BigNumber(price),
					pair: symbol
				});
			} else {
				throw new Error(`Unable to understand order side: ${side}`);
			}
		} else if (type === 'STOP_LOSS_LIMIT') {
			assert(price);
			assert(stopPrice);
			if (side === 'SELL') {
				try {
					return await this.add_stop_loss_limit_sell_order({
						base_volume: BigNumber(quantity),
						price: BigNumber(price),
						stopPrice: BigNumber(stopPrice),
						pair: symbol
					});
				} catch (e) {
					async_error_handler(null, null, e);
				}
			} else {
				throw new Error(`Unable to understand order side: ${side}`);
			}
		} else {
			throw new Error(`Unable to understand order type: ${type}`);
		}
	}

	async cancelOrder({ symbol, orderId } = {}) {
		let order = this.open_orders.find((o) => o.orderId === orderId && o.symbol === symbol);
		if (order) {
			const base_volume = order['origQty'];
			assert(order.type === 'LIMIT' || order.type === 'STOP_LOSS_LIMIT');
			if (order.side === 'BUY') {
				const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: order.price });
				this._unlock_balance(this.quote_currency, quote_volume);
			}
			if (order.side === 'SELL') {
				this._unlock_balance(this.base_currency, base_volume);
			}
			this.cancelled_orders = this.cancelled_orders.concat([ order ]);
			this.open_orders = this.open_orders.filter((o) => o.orderId !== orderId);
		}
	}

	async accountInfo() {
		let balances = [];
		Object.keys(this.balances).forEach((asset) => {
			if (!this.balances[asset].free.isZero() || !this.balances[asset].locked.isZero())
				balances.push({
					asset,
					free: this.balances[asset].free.toFixed(),
					locked: this.balances[asset].locked.toFixed()
				});
		});

		return {
			balances
		};
	}

	async prices() {
		let prices = {};
		for (var key in this.known_prices) {
			prices[key] = this.known_prices[key].toFixed();
		}
		return prices;
	}

	async ws_user(user_cb) {
		if (this.user_cb) throw new Error('Only one user callback implemented atm');
		this.user_cb = user_cb;
	}

	async ws_agg_trades(pairs, cb) {
		if (this.agg_trades_cb) throw new Error('Only one aggTrades callback implemented atm');
		this.agg_trades_cb = cb;
	}

	send_ws_events(completed_orders) {
		if (this.user_cb) {
			let mapper = (m) => ({
				eventType: 'executionReport',
				symbol: m.symbol,
				orderId: m.orderId,
				orderStatus: m.orderStatus,
				orderType: m.type,
				side: m.side
			});
			completed_orders.forEach((order) => this.user_cb(mapper(order)));
		}
	}

	async send_ws_trades_events(trade) {
		if (this.agg_trades_cb) {
			await this.agg_trades_cb(trade);
		}
	}
}

module.exports = ExchangeEmulator;
