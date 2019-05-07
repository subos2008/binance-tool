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

const BigNumber = require('bignumber.js');
const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);
const assert = require('assert');
const utils = require('../lib/utils');
const async_error_handler = require('../lib/async_error_handler');

const { OrderTooSmallError, InsufficientBalanceError } = require('./errors');
const { NotImplementedError } = require('./errors');

class ExchangeEmulator {
	constructor({ logger, starting_quote_balance, starting_base_balance, exchange_info } = {}) {
		assert(starting_quote_balance);
		assert(logger);
		this.logger = logger;
		this.exchange_info = exchange_info;
		assert(BigNumber.isBigNumber(starting_quote_balance));
		this.quote_coin_balance_not_in_orders = starting_quote_balance;
		this.quote_coin_balance_in_orders = BigNumber(0);
		if (starting_base_balance) {
			assert(BigNumber.isBigNumber(starting_base_balance));
			this.base_coin_balance_not_in_orders = starting_base_balance;
		} else {
			this.base_coin_balance_not_in_orders = BigNumber(0);
		}
		this.base_coin_balance_in_orders = BigNumber(0);
		// FIXME: urgh, null vs undefined etc... and we check for this
		// all over the place. Some kind of code smell.
		this.current_price = null;
		this.open_orders = [];
		this.completed_orders = [];
		this.cancelled_orders = [];
		this.next_order_id = 1;
		this._sanity_check();
		// binance-api-node API
		this.ws = { user: this.ws_user.bind(this), aggTrades: this.ws_agg_trades.bind(this) };
	}

	set quote_coin_balance_in_orders(value) {
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		this._quote_coin_balance_in_orders = value;
	}

	set quote_coin_balance_not_in_orders(value) {
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		this._quote_coin_balance_not_in_orders = value;
	}

	get quote_coin_balance_in_orders() {
		return this._quote_coin_balance_in_orders;
	}

	get quote_coin_balance_not_in_orders() {
		return this._quote_coin_balance_not_in_orders;
	}

	get quote_coin_balance() {
		return this.quote_coin_balance_in_orders.plus(this.quote_coin_balance_not_in_orders);
	}

	set base_coin_balance_not_in_orders(value) {
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		this._base_coin_balance_not_in_orders = value;
	}

	get base_coin_balance_not_in_orders() {
		return this._base_coin_balance_not_in_orders;
	}

	set base_coin_balance_in_orders(value) {
		assert(BigNumber.isBigNumber(value));
		assert(value.isGreaterThanOrEqualTo(0));
		this._base_coin_balance_in_orders = value;
	}

	get base_coin_balance_in_orders() {
		return this._base_coin_balance_in_orders;
	}

	get base_coin_balance_total() {
		return this._base_coin_balance_in_orders.plus(this._base_coin_balance_not_in_orders);
	}

	async base_coin_balance() {
		return this.base_coin_balance_total;
	}

	async set_current_price({ price, symbol } = {}) {
		assert(symbol);
		if (BigNumber.isBigNumber(price)) {
			this.current_price = price;
		} else {
			throw Error(`'${price}' is not a BigNumber`);
		}
		try {
			await this._check_for_completed_limit_orders({ price });
		} catch (e) {
			async_error_handler(this.logger, 'set_current_price when checking for completed limit orders:', e);
		}
		this.send_ws_trades_events({ price, symbol });
		this._sanity_check();
	}

	dump() {
		this.logger.debug(`Exchange quote balance: ${this.quote_coin_balance}`);
		this.logger.debug(`Exchange base balance: ${this.base_coin_balance_not_in_orders}`);
		this.logger.debug(`Exchange base balance in orders: ${this.base_coin_balance_in_orders}`);
		if (this.current_price !== null) {
			this.logger.debug(`Exchange liquidated quote balance: ${this.balance_in_quote_coin()}`);
		}
	}

	market_buy_by_quote_volume({ quote_volume } = {}) {
		this._sanity_check();
		try {
			assert(BigNumber.isBigNumber(quote_volume));
			assert(quote_volume.isLessThanOrEqualTo(this.quote_coin_balance));
		} catch (e) {
			this.logger.error(
				`Exchange Error: quote_volume: ${quote_volume} <= this.quote_coin_balance: ${this.quote_coin_balance}`
			);
			throw e;
		}

		this.quote_coin_balance = this.quote_coin_balance.minus(quote_volume);

		if (this.current_price === null) {
			const msg = `Market buy called when current_price is ${this.current_price}`;
			this.logger.error(msg);
			throw msg;
		}
		const base_volume = quote_volume.dividedBy(this.current_price);
		this.logger.info(`Bought ${base_volume} for ${quote_volume} at ${this.current_price}`);
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.plus(base_volume);
		this._sanity_check();
		return { quote_volume, base_volume, price: this.current_price };
	}

	base_coin_balance_is_non_zero() {
		return (
			this.base_coin_balance_not_in_orders.isGreaterThan(0) || this.base_coin_balance_in_orders.isGreaterThan(0)
		);
	}

	_sanity_check() {
		// try {
		assert(BigNumber.isBigNumber(this.quote_coin_balance_in_orders));
		assert(BigNumber.isBigNumber(this.quote_coin_balance_not_in_orders));
		assert(BigNumber.isBigNumber(this.base_coin_balance_not_in_orders));
		assert(BigNumber.isBigNumber(this.base_coin_balance_in_orders));
		assert(this.current_price === null || BigNumber.isBigNumber(this.current_price));
		assert(this.quote_coin_balance_in_orders.isGreaterThanOrEqualTo(0));
		assert(this.quote_coin_balance_not_in_orders.isGreaterThanOrEqualTo(0));
		assert(this.base_coin_balance_not_in_orders.isGreaterThanOrEqualTo(0));
		assert(this.base_coin_balance_in_orders.isGreaterThanOrEqualTo(0));
		// } catch (e) {
		//   this.logger.error("_sanity_check failed");
		//   this.dump();
		//   throw e;
		// }
	}

	market_sell_by_base_volume({ base_volume } = {}) {
		this._sanity_check();
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.minus(base_volume);
		const quote_volume = base_volume.times(this.current_price);
		this.quote_coin_balance = this.quote_coin_balance.plus(quote_volume);
		this._sanity_check();
	}

	async add_limit_buy_order({ base_volume, limit_price, pair } = {}) {
		try {
			assert(BigNumber.isBigNumber(base_volume));
			assert(BigNumber.isBigNumber(limit_price));
			assert(base_volume.isGreaterThan(0));
			assert(limit_price.isGreaterThan(0));
			assert(pair);
			const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: limit_price });
			if (this.quote_coin_balance_not_in_orders.isLessThan(quote_volume)) {
				throw new InsufficientBalanceError(
					`this.quote_coin_balance_not_in_orders must be >= quote_volume: base_volume: ${base_volume}, limit_price: ${limit_price} quote_coin_balance_not_in_orders: ${this
						.quote_coin_balance_not_in_orders}, quote_volume: ${quote_volume}`
				);
			}
			this._sanity_check();
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
			this.quote_coin_balance_not_in_orders = this.quote_coin_balance_not_in_orders.minus(quote_volume);
			this.quote_coin_balance_in_orders = this.quote_coin_balance_in_orders.plus(quote_volume);
			this._sanity_check();
			return { orderId: id };
		} catch (e) {
			async_error_handler(this.logger, `failed add_limit_buy_order`, e);
		}
	}

	async add_limit_sell_order({ base_volume, limit_price, pair } = {}) {
		try {
			assert(BigNumber.isBigNumber(base_volume));
			assert(BigNumber.isBigNumber(limit_price));
			assert(base_volume.isGreaterThan(0));
			assert(limit_price.isGreaterThan(0)); // really?
			assert(pair);
			assert(
				this.base_coin_balance_not_in_orders.isGreaterThanOrEqualTo(base_volume),
				'this.base_coin_balance_not_in_orders must be >= base_volume'
			);
		} catch (e) {
			this.logger.error(
				`Asserts failed in add_limit_sell_order with args: base_volume: ${base_volume}, limit_price: ${limit_price} base_coin_balance_not_in_orders: ${this
					.base_coin_balance_not_in_orders}`
			);
			throw e;
		}
		this._sanity_check();
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
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.minus(base_volume);
		this.base_coin_balance_in_orders = this.base_coin_balance_in_orders.plus(base_volume);
		this._sanity_check();
		return { orderId: id };
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
				`Asserts failed in add_stop_loss_limit_sell_order with args: base_volume: ${base_volume}, price: ${price} stopPrice: ${stopPrice} base_coin_balance_not_in_orders: ${this
					.base_coin_balance_not_in_orders}`
			);
			throw e;
		}

		if (this.base_coin_balance_not_in_orders.isLessThan(base_volume)) {
			throw new InsufficientBalanceError('this.base_coin_balance_not_in_orders must be >= base_volume');
		}

		this._sanity_check();
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
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.minus(base_volume);
		this.base_coin_balance_in_orders = this.base_coin_balance_in_orders.plus(base_volume);
		this._sanity_check();
		return { orderId: id };
	}

	// TODO: fees
	_execute_hit_limit_sell({ order } = {}) {
		this._sanity_check();
		const base_volume = order['origQty'];
		const price = order['price'];
		assert(BigNumber.isBigNumber(base_volume));
		assert(BigNumber.isBigNumber(price));
		assert(this.base_coin_balance_in_orders.isGreaterThanOrEqualTo(base_volume));
		this.base_coin_balance_in_orders = this.base_coin_balance_in_orders.minus(base_volume);
		const quote_volume = base_volume.times(price);
		// TODO: this is wrong - it should be quote_coin_balance_not_in_orders on both sides of the '=' ??
		this.quote_coin_balance_not_in_orders = this.quote_coin_balance.plus(quote_volume);
		order.orderStatus = 'FILLED';
		this.completed_orders.push(order);
		this.logger.info(`Hit limit sell: sold ${base_volume} at ${price} for ${quote_volume}`);
		this._sanity_check();
		return order;
	}

	// TODO: fees
	_execute_hit_limit_buy({ order } = {}) {
		this._sanity_check();
		const base_volume = order['origQty'];
		const price = order['price'];
		assert(BigNumber.isBigNumber(base_volume));
		assert(BigNumber.isBigNumber(price));
		const quote_volume = base_volume.times(price);
		assert(this.quote_coin_balance_in_orders.isGreaterThanOrEqualTo(quote_volume));
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.plus(base_volume);
		this.quote_coin_balance_in_orders = this.quote_coin_balance_in_orders.minus(quote_volume);
		order.orderStatus = 'FILLED';
		this.completed_orders.push(order);
		this.logger.info(`Hit limit buy: bought ${base_volume} at ${price} for ${quote_volume}`);
		this._sanity_check();
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

	_release_quote_volume({ quote_volume }) {
		this.quote_coin_balance_in_orders = this.quote_coin_balance_in_orders.minus(quote_volume);
		this.quote_coin_balance_not_in_orders = this.quote_coin_balance_not_in_orders.plus(quote_volume);
	}

	_release_base_volume({ base_volume }) {
		this.base_coin_balance_in_orders = this.base_coin_balance_in_orders.minus(base_volume);
		this.base_coin_balance_not_in_orders = this.base_coin_balance_not_in_orders.plus(base_volume);
	}

	// TODO: this should be namespaced to the traded pair
	async cancel_all_open_orders() {
		this.open_orders.forEach((order) => {
			const base_volume = order['origQty'];
			assert(order.type === 'LIMIT');
			if (order.side === 'BUY') {
				const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: order.price });
				this._release_quote_volume({ quote_volume });
			}
			if (order.side === 'SELL') {
				this._release_base_volume({ base_volume });
			}
		});
		this.cancelled_orders = this.cancelled_orders.concat(this.open_orders);
		// TODO: send event to .ws.user
		this.open_orders = [];
	}

	async liquidate() {
		// await this.cancel_all_open_orders()
		// await this.market_sell_by_base_volume(this.base_coin_balance_not_in_orders)
		// this._sanity_check()
		throw NotImplementedError();
	}

	balance_in_quote_coin() {
		var balance_in_quote_coin = this.quote_coin_balance;
		if (this.base_coin_balance_is_non_zero()) {
			assert(this.current_price !== null);
			var base_coin_balance = this.base_coin_balance_not_in_orders.plus(this.base_coin_balance_in_orders);
			const unliquidated_balance = base_coin_balance.times(this.current_price);
			balance_in_quote_coin = balance_in_quote_coin.plus(unliquidated_balance);
		}
		assert(BigNumber.isBigNumber(balance_in_quote_coin));
		return balance_in_quote_coin;
	}

	// API for binance-api-node
	async exchangeInfo() {
		return this.exchange_info;
	}

	async order({ side, symbol, type, quantity, price, stopPrice } = {}) {
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
				this._release_quote_volume({ quote_volume });
			}
			if (order.side === 'SELL') {
				this._release_base_volume({ base_volume });
			}
			this.cancelled_orders = this.cancelled_orders.concat([ order ]);
			this.open_orders = this.open_orders.filter((o) => o.orderId !== orderId);
		}
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

	send_ws_trades_events(trade) {
		if (this.agg_trades_cb) {
			this.agg_trades_cb(trade);
		}
	}
}

module.exports = ExchangeEmulator;
