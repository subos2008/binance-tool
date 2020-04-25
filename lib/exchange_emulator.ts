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

import { BigNumber } from 'bignumber.js';
import { Logger } from '../interfaces/logger';
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

const assert = require('assert');
const utils = require('../lib/utils');
const async_error_handler = require('../lib/async_error_handler');
const asyncForEach = require('./async_foreach');

const { NotImplementedError, InsufficientBalanceError } = require('../lib/errors');

function split_pair(pair: string) {
  const [total, base_currency, quote_currency] = utils.break_up_binance_pair(pair);
  return {
    quote_currency,
    base_currency
  };
}

class Order {
  symbol: string
  type: string
  orderId: string
  origQty: string
  side: string
  price: string
  stopPrice: string | undefined
  _base_currency: string
  _quote_currency: string
  orderStatus: string
  executedQty: string


  constructor({ origQty, price, stopPrice, type, side, symbol, orderId }: { origQty: string, price: string, stopPrice?: string, type: string, side: string, symbol: string, orderId: string }) {
    assert((this.origQty = origQty)); //: base_volume,
    assert((this.type = type)); // 'LIMIT', 'STOP_LOSS_LIMIT'
    assert((this.side = side)); //: 'BUY',
    assert((this.symbol = symbol)); // : pair,
    assert((this.orderId = orderId));
    this.price = price; // : limit_price,
    this.stopPrice = stopPrice; //
  }
  get base_currency() {
    if (typeof this._base_currency === 'undefined') {
      //dup
      let { quote_currency, base_currency } = split_pair(this.symbol);
      this._quote_currency = quote_currency;
      this._base_currency = base_currency;
    }
    return this._base_currency;
  }
  get quote_currency() {
    if (typeof this._quote_currency === 'undefined') {
      //dup
      let { quote_currency, base_currency } = split_pair(this.symbol);
      this._quote_currency = quote_currency;
      this._base_currency = base_currency;
    }
    return this._quote_currency;
  }
}

export class ExchangeEmulator {
  logger: Logger
  starting_balances: BigNumber
  starting_quote_balance: BigNumber
  starting_base_balance: BigNumber
  base_currency: string
  quote_currency: string
  exchange_info: any
  balances: { [currency: string]: { free: BigNumber, locked: BigNumber } }
  open_orders: Order[]
  completed_orders: Order[]
  cancelled_orders: Order[]
  _next_order_id: number = 1
  ws: any
  user_cb: any // callback
  agg_trades_cb: any // callback
  agg_trades_watched_pairs:string[]
  known_prices: { [key: string]: BigNumber }


  get next_order_id(): string {
    const id = this._next_order_id.toString();
    this._next_order_id += 1;
    return id
  }

  set next_order_id(foo) {
    throw new Error;
  }

  constructor(
    {
      logger,
      starting_balances,
      starting_quote_balance,
      starting_base_balance,
      base_currency,
      quote_currency,
      exchange_info
    }: {
      logger: Logger
      starting_balances: { [currency: string]: BigNumber }
      starting_quote_balance: BigNumber
      starting_base_balance: BigNumber
      base_currency: string
      quote_currency: string
      exchange_info: any
    }
  ) {
    if (typeof starting_quote_balance === 'undefined') starting_quote_balance = new BigNumber(0);
    assert(starting_quote_balance);
    assert(logger);
    this.logger = logger;
    this.exchange_info = exchange_info;

    this.balances = {};

    this.open_orders = [];
    this.completed_orders = [];
    this.cancelled_orders = [];
    // binance-api-node API
    this.ws = { user: this.ws_user.bind(this), aggTrades: this.ws_agg_trades.bind(this) };
    this.known_prices = {};
    if (starting_balances) {
      Object.keys(starting_balances).forEach((asset) => {
        this.balances[asset] = { locked: new BigNumber(0), free: new BigNumber(starting_balances[asset]) };
      });
    }
  }

  _set_free_balance(currency: string, value: BigNumber) {
    assert(currency);
    assert(BigNumber.isBigNumber(value));
    assert(value.isGreaterThanOrEqualTo(0));
    if (!(currency in this.balances)) this.balances[currency] = { locked: new BigNumber(0), free: value };
    this.balances[currency].free = value;
  }

  _set_locked_balance(currency: string, value: BigNumber) {
    assert(currency);
    assert(BigNumber.isBigNumber(value));
    assert(value.isGreaterThanOrEqualTo(0));
    if (!(currency in this.balances)) this.balances[currency] = { free: new BigNumber(0), locked: value };
    this.balances[currency].locked = value;
  }

  _lock_balance(currency: string, amount: BigNumber) {
    this._set_locked_balance(currency, this.balance_in_orders(currency).plus(amount));
    this._set_free_balance(currency, this.balance_not_in_orders(currency).minus(amount));
  }

  _unlock_balance(currency: string, amount: BigNumber) {
    this._set_locked_balance(currency, this.balance_in_orders(currency).minus(amount));
    this._set_free_balance(currency, this.balance_not_in_orders(currency).plus(amount));
  }

  // trades call this
  _exchange_balances_from_locked_to_free(from_currency: string, from_amount: BigNumber, to_currency: string, to_amount: BigNumber) {
    assert(from_currency);
    assert(to_currency);
    if (!this.balance_in_orders(from_currency).isGreaterThanOrEqualTo(from_amount)) {
      throw new InsufficientBalanceError(
        `this.balance_in_orders(${from_currency}) must be >= ${from_amount}, actual value: ${this.balance_not_in_orders(
          from_currency
        )}`
      );
    }
    this._set_locked_balance(from_currency, this.balance_in_orders(from_currency).minus(from_amount));
    this._set_free_balance(to_currency, this.balance_not_in_orders(to_currency).plus(to_amount));
  }

  balance_not_in_orders(currency: string) {
    if (currency in this.balances) {
      return this.balances[currency].free;
    } else {
      return new BigNumber(0);
    }
  }

  balance_in_orders(currency: string) {
    if (currency in this.balances) {
      return this.balances[currency].locked;
    } else {
      return new BigNumber(0);
    }
  }

  // used by some tests
  get quote_coin_balance_in_orders() {
    return this.balance_in_orders(this.quote_currency);
  }

  total_balance(currency: string) {
    return this.balance_in_orders(currency).plus(this.balance_not_in_orders(currency));
  }

  async set_current_price({ price, symbol }: { price: BigNumber, symbol: string }) {
    assert(symbol);
    this.known_prices[symbol] = price;
    try {
      await this._check_for_completed_orders({ price, symbol });
    } catch (e) {
      async_error_handler(this.logger, 'set_current_price when checking for completed limit orders:', e);
    }
    try {
      await this.send_ws_trades_events({ price: price.toFixed(), symbol });
    } catch (e) {
      async_error_handler(this.logger, 'set_current_price when sending ws trades events:', e);
    }
  }

  async add_limit_buy_order({ base_volume, limit_price, pair }: { base_volume: BigNumber|string, limit_price: BigNumber|string, pair: string }) {
    base_volume = new BigNumber(base_volume)
    limit_price = new BigNumber(limit_price)
    try {
      assert(base_volume.isGreaterThan(0));
      assert(limit_price.isGreaterThan(0));
      assert(pair);
      let quote_currency = utils.quote_currency_for_binance_pair(pair);
      const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: limit_price });
      if (this.balance_not_in_orders(quote_currency).isLessThan(quote_volume)) {
        throw new InsufficientBalanceError(
          `this.balance_not_in_orders(quote_currency) must be >= quote_volume: base_volume: ${base_volume.toFixed()}, limit_price: ${limit_price.toFixed()} balance_not_in_orders(quote_currency): ${this.balance_not_in_orders(
            quote_currency
          )}, quote_volume: ${quote_volume.toFixed()}`
        );
      }
      const id = this.next_order_id;
      this.open_orders.push(
        new Order({
          origQty: base_volume.toFixed(),
          price: limit_price.toFixed(),
          type: 'LIMIT',
          side: 'BUY',
          symbol: pair,
          orderId: id
        })
      );
      this._lock_balance(quote_currency, quote_volume);
      return { orderId: id };
    } catch (e) {
      async_error_handler(this.logger, `failed add_limit_buy_order`, e);
    }
  }

  async add_market_buy_order({ base_volume, pair }: { base_volume: BigNumber, pair: string }) {
    try {
      assert(BigNumber.isBigNumber(base_volume));
      assert(base_volume.isGreaterThan(0));
      assert(pair);
      let quote_currency = utils.quote_currency_for_binance_pair(pair);
      let price = this.known_prices[pair];
      const quote_volume = utils.base_volume_at_price_to_quote_volume({
        base_volume,
        price
      });
      if (this.balance_not_in_orders(quote_currency).isLessThan(quote_volume)) {
        throw new InsufficientBalanceError(
          `this.balance_not_in_orders(quote_currency) must be >= quote_volume: base_volume: ${base_volume}, market_price: ${price} balance_not_in_orders(quote_currency): ${this.balance_not_in_orders(
            quote_currency
          )}, quote_volume: ${quote_volume}`
        );
      }
      const id = this.next_order_id;
      this.open_orders.push(
        new Order({
          origQty: base_volume.toFixed(),
          price: price.toFixed(),
          type: 'MARKET',
          side: 'BUY',
          symbol: pair,
          orderId: id
        })
      );
      this._lock_balance(quote_currency, quote_volume);
      return { orderId: id };
    } catch (e) {
      async_error_handler(this.logger, `failed add_market_buy_order`, e);
    }
  }

  async add_limit_sell_order({ base_volume, limit_price, pair }: { base_volume: BigNumber|string, limit_price: BigNumber|string, pair: string }) {
    base_volume = new BigNumber(base_volume)
    limit_price = new BigNumber(limit_price)
    try {
      assert(base_volume.isGreaterThan(0));
      assert(limit_price.isGreaterThan(0)); // really?
      assert(pair);
      let { base_currency } = split_pair(pair);
      // TODO: throw InsufficientBalanceError  ... but really do whatever binance API does
      assert(
        this.balance_not_in_orders(base_currency).isGreaterThanOrEqualTo(base_volume),
        `this.balance_not_in_orders, ${this.balance_not_in_orders(
          base_currency
        ).toFixed()} ${base_currency}, must be >= base_volume (${base_volume.toFixed()}). Balances: ${JSON.stringify(
          this.balances
        )}`
      );
      const id = this.next_order_id;
      this.open_orders.push(
        new Order({
          origQty: base_volume.toString(),
          price: limit_price.toString(),
          type: 'LIMIT',
          side: 'SELL',
          symbol: pair,
          orderId: id
        })
      );
      this._lock_balance(base_currency, base_volume);
      return { orderId: id };
    } catch (e) {
      this.logger.error(
        `Error in add_limit_sell_order with args: base_volume: ${base_volume.toFixed()}, limit_price: ${limit_price.toFixed()}`
      );
      throw e;
    }
  }

  async add_stop_loss_limit_sell_order({ base_volume, price, stop_price, pair }: { base_volume: BigNumber, price: BigNumber, stop_price: BigNumber, pair: string }) {
    try {
      assert(BigNumber.isBigNumber(base_volume));
      assert(BigNumber.isBigNumber(price));
      assert(BigNumber.isBigNumber(stop_price));
      assert(base_volume.isGreaterThan(0));
      assert(price.isGreaterThan(0)); // really?
      assert(stop_price.isGreaterThan(0));
      // we currently assume stop sell orders are downwards, they are right?
      assert(stop_price.isGreaterThanOrEqualTo(price));
      assert(pair);
    } catch (e) {
      this.logger.error(
        `Asserts failed in add_stop_loss_limit_sell_order with args: base_volume: ${base_volume}, price: ${price} stopPrice: ${stop_price}`
      );
      throw e;
    }

    let { base_currency } = split_pair(pair);
    if (this.balance_not_in_orders(base_currency).isLessThan(base_volume)) {
      throw new InsufficientBalanceError(`this.balance_not_in_orders(${base_currency}) must be >= base_volume`);
    }

    const id = this.next_order_id;
    this.open_orders.push(
      new Order({
        origQty: base_volume.toFixed(),
        price: price.toFixed(),
        stopPrice: stop_price.toFixed(),
        type: 'STOP_LOSS_LIMIT',
        side: 'SELL',
        symbol: pair,
        orderId: id
      })
    );
    this._lock_balance(base_currency, base_volume);
    return { orderId: id };
  }

  // TODO: fees
  _execute_hit_sell_order({ order, price }: { order: Order, price: string }) {
    const base_volume = new BigNumber(order['origQty']);
    assert(BigNumber.isBigNumber(base_volume));
    assert(BigNumber.isBigNumber(price));
    const quote_volume = base_volume.times(price);
    this._exchange_balances_from_locked_to_free(
      order.base_currency,
      base_volume,
      order.quote_currency,
      quote_volume
    );
    order.orderStatus = 'FILLED';
    order.executedQty = base_volume.toFixed();
    this.completed_orders.push(order);
    this.logger.info(`Hit ${order.type} sell: sold ${base_volume} at ${price} for ${quote_volume}`);
    return order;
  }

  // TODO: fees. TODO: take price?
  _execute_hit_buy_order({ order }: { order: Order }) {
    const base_volume = new BigNumber(order['origQty']);
    const price = new BigNumber(order['price']);
    assert(BigNumber.isBigNumber(base_volume));
    assert(BigNumber.isBigNumber(price));
    const quote_volume = base_volume.times(price);
    this._exchange_balances_from_locked_to_free(
      order.quote_currency,
      quote_volume,
      order.base_currency,
      base_volume
    );
    order.executedQty = base_volume.toFixed();
    order.orderStatus = 'FILLED';
    this.completed_orders.push(order);
    this.logger.info(`Hit limit buy: bought ${base_volume} at ${price} for ${quote_volume}`);
    return order;
  }

  async _check_for_completed_orders({ price, symbol }: { price: BigNumber, symbol: string }) {
    assert(BigNumber.isBigNumber(price));
    var remaining_orders: Order[] = [];
    var completed_orders: Order[] = [];
    console.log(`in _check_for_completed_orders`)
    this.open_orders.forEach((order) => {
      console.log(`Checking ${order.symbol} === ${symbol} and ${price} == ${order['price']}`)
      if ((order.symbol === symbol && price.isEqualTo(order['price'])) || order.type === 'MARKET') {
        // TODO: this does execute stop limit orders but ...
        if (order.side === 'SELL') {
          completed_orders.push(this._execute_hit_sell_order({ order, price: price.toFixed() }));
        } else if (order.side === 'BUY') {
          completed_orders.push(this._execute_hit_buy_order({ order }));
        } else {
          throw new Error('Unknown order type');
        }
      } else {
        remaining_orders.push(order);
      }
    });
    this.open_orders = remaining_orders;
    try {
      await this.send_ws_events(completed_orders);
    } catch (error) {
      this.logger.error("Urgh: exception thrown by send_ws_events! That shouldn't happen!");
      this.logger.error(error);
    }
    return completed_orders;
  }

  //---------- END check_for_completed_limit_orders ---------------------

  // TODO: this should be namespaced to the traded pair
  async cancel_all_open_orders() {
    this.open_orders.forEach((order) => {
      const base_volume = new BigNumber(order['origQty']);
      assert(order.type === 'LIMIT');
      if (order.side === 'BUY') {
        const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume, price: new BigNumber(order.price) });
        this._unlock_balance(order.quote_currency, quote_volume);
      }
      if (order.side === 'SELL') {
        this._unlock_balance(order.base_currency, new BigNumber(base_volume));
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

  async order({ side, symbol, type, quantity, price, stopPrice }: { side: string, symbol: string, type: string, quantity: string, price: string, stopPrice: string }) {
    assert(symbol);
    // assert known symbol
    assert(this.exchange_info.symbols.find((ei: any) => ei.symbol === symbol));
    if (typeof price !== 'undefined') {
      let munged_price = utils.munge_and_check_price({ price, exchange_info: this.exchange_info, symbol });
      if (!new BigNumber(price).isEqualTo(munged_price)) {
        throw new Error(
          `.order passed unmunged price: PRICE_FILTER: Precision is over the maximum defined for this asset`
        );
      }
    }
    if (typeof stopPrice !== 'undefined') {
      let munged_price = utils.munge_and_check_price({
        price: stopPrice,
        exchange_info: this.exchange_info,
        symbol
      });
      if (!new BigNumber(stopPrice).isEqualTo(munged_price)) {
        throw new Error(
          `.order passed unmunged stopPrice: PRICE_FILTER: Precision is over the maximum defined for this asset`
        );
      }
    }
    if (typeof quantity !== 'undefined') {
      let munged_volume = utils.munge_and_check_quantity({
        volume: quantity,
        exchange_info: this.exchange_info,
        symbol
      });
      if (!new BigNumber(munged_volume).isEqualTo(quantity)) {
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
          base_volume: new BigNumber(quantity),
          limit_price: new BigNumber(price),
          pair: symbol
        });
      } else if (side === 'SELL') {
        return await this.add_limit_sell_order({
          base_volume: new BigNumber(quantity),
          limit_price: new BigNumber(price),
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
            base_volume: new BigNumber(quantity),
            price: new BigNumber(price),
            stop_price: new BigNumber(stopPrice),
            pair: symbol
          });
        } catch (e) {
          async_error_handler(null, null, e);
        }
      } else {
        throw new Error(`Unable to understand order side: ${side}`);
      }
    } else if (type === 'MARKET') {
      if (side === 'BUY') {
        return await this.add_market_buy_order({
          base_volume: new BigNumber(quantity),
          pair: symbol
        });
      } else {
        throw new Error(`Unable to understand order side: ${side}`);
      }
    } else {
      throw new Error(`Unable to understand order type: ${type}`);
    }
  }

  async cancelOrder({ symbol, orderId }: { symbol: string, orderId: string }) {
    let order = this.open_orders.find((o) => o.orderId === orderId && o.symbol === symbol);
    if (order) {
      const base_volume = order['origQty'];
      assert(order.type === 'LIMIT' || order.type === 'STOP_LOSS_LIMIT');
      if (order.side === 'BUY') {
        const quote_volume = utils.base_volume_at_price_to_quote_volume({ base_volume:new BigNumber(base_volume), price: new BigNumber(order.price) });
        this._unlock_balance(order.quote_currency, quote_volume);
      }
      if (order.side === 'SELL') {
        this._unlock_balance(order.base_currency, new BigNumber(base_volume));
      }
      this.cancelled_orders = this.cancelled_orders.concat([order]);
      this.open_orders = this.open_orders.filter((o) => o.orderId !== orderId);
    }
  }

  async accountInfo() {
    let balances: { asset: string, free: string, locked: string }[] = [];
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
    let prices : { [key:string]: string} = {}
    for (var key in this.known_prices) {
      prices[key] = this.known_prices[key].toFixed();
    }
    return prices;
  }

  async ws_user(user_cb:any) {
    if (this.user_cb) throw new Error('Only one user callback implemented atm');
    this.user_cb = user_cb;
  }

  async ws_agg_trades(pairs:string[], cb:any) {
    if (this.agg_trades_cb) throw new Error('Only one aggTrades callback implemented atm');
    this.agg_trades_watched_pairs = pairs;
    this.agg_trades_cb = cb;
  }

  async send_ws_events(completed_orders:Order[]) {
    if (!this.user_cb) return;
    let mapper = (m:Order) => ({
      orderId: m.orderId,
      price: m.price,
      quantity: m.origQty,
      eventType: 'executionReport',
      symbol: m.symbol,
      orderStatus: m.orderStatus,
      orderType: m.type,
      side: m.side,
      totalTradeQuantity: m.executedQty,
      lastTradeQuantity: m.executedQty
    });
    let obj = this;
    async function callback(order:Order) {
      assert(order);
      try {
        await obj.user_cb(mapper(order));
      } catch (error) {
        obj.logger.error(`Error: exception in client callback for user events!`);
        obj.logger.error(error);
      }
    }
    await asyncForEach(this.logger, completed_orders, callback);
  }

  async send_ws_trades_events(trade:any) {
    if (this.agg_trades_cb) {
      if (this.agg_trades_watched_pairs.includes(trade.symbol)) await this.agg_trades_cb(trade);
    }
  }
}


