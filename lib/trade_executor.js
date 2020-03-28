const async_error_handler = require("./async_error_handler");
const { ExitNow } = require("./errors");
const BigNumber = require("bignumber.js");
const utils = require("./utils");
const assert = require("assert");
const PositionSizer = require("./position_sizer");
const AlgoUtils = require("../service_lib/algo_utils");

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
  throw Error("BigNumber .valueOf called!");
};

class TradeExecutor {
  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    trade_state,
    trade_definition,
    base_amount_to_buy,
    // base_amount_held, // now in trade_state - initialise it in there if we support '-a'
    percentage_before_soft_buy_price_to_add_order = BigNumber("0.5"),
    trading_rules,
    percentages
  } = {}) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;

    assert(ee);
    this.ee = ee;
    assert(trade_definition);

    var {
      pair,
      max_quote_amount_to_buy,
      buy_price,
      stop_price,
      limit_price,
      target_price,
      nonBnbFees,
      soft_entry,
      auto_size
    } = trade_definition;

    this.logger.warn(`WARNING -a is UNTESTED in this CODE`);

    this.trading_rules = trading_rules;
    this.percentages = percentages; // wtf is this?

    //---
    this.pair = pair;
    this.base_amount_to_buy = base_amount_to_buy;
    this.max_quote_amount_to_buy = max_quote_amount_to_buy;
    this.buy_price = buy_price;
    this.stop_price = stop_price;
    this.target_price = target_price;
    this.nonBnbFees = nonBnbFees;
    this.soft_entry = soft_entry;
    this.auto_size = auto_size;
    //---

    assert(trade_state);
    this.trade_state = trade_state;

    if (max_quote_amount_to_buy) {
      this.max_quote_amount_to_buy = max_quote_amount_to_buy = BigNumber(
        max_quote_amount_to_buy
      );
    }

    if (buy_price) {
      this.buy_price = buy_price = BigNumber(buy_price);
    }

    if (base_amount_to_buy) {
      this.base_amount_to_buy = BigNumber(base_amount_to_buy);
    }

    if (stop_price) {
      this.stop_price = stop_price = BigNumber(stop_price);
    }
    if (limit_price) {
      this.limit_price = limit_price = BigNumber(limit_price);
    }
    if (target_price) {
      this.target_price = target_price = BigNumber(target_price);
    }

    // require that the user at least pass in trading rules, this allows much
    // more solid code downstream as we can assert that the trading_rules are present,
    // otherwise we would ignore them if they were undefined which leaves the potential
    // for massive fuckups
    assert(trading_rules);

    this.algo_utils = new AlgoUtils({ logger, ee });

    this.pair = pair = this.pair.toUpperCase();
    let { quote_currency, base_currency } = this.algo_utils.split_pair(pair);
    this.quote_currency = quote_currency;
    this.base_currency = base_currency;
    if (buy_price && stop_price && !buy_price.isZero())
      assert(stop_price.isLessThan(buy_price));
    if (target_price && buy_price)
      assert(target_price.isGreaterThan(buy_price));
    if (target_price && stop_price)
      assert(target_price.isGreaterThan(stop_price));

    if (this.soft_entry) {
      assert(this.buy_price);
      this.soft_entry_buy_order_trigger_price = this.buy_price.times(
        BigNumber(100)
          .plus(percentage_before_soft_buy_price_to_add_order)
          .div(100)
      );
      this.logger.info(
        `Soft entry buy order trigger price ${this.soft_entry_buy_order_trigger_price.toFixed()}`
      );
    }

    this.position_sizer = new PositionSizer({ logger, ee, trading_rules });

    this.logger.warn(`WARNING: STOP_LOSS_LIMIT orders need work`);

    process.on("exit", () => {
      this.shutdown_streams();
    });
  }

  get buyOrderId() {
    throw new Error(`depricated`);
  }
  get stopOrderId() {
    throw new Error(`depricated`);
  }
  get targetOrderId() {
    throw new Error(`depricated`);
  }
  set buyOrderId(foo) {
    throw new Error(`depricated`);
  }
  set stopOrderId(foo) {
    throw new Error(`depricated`);
  }
  set targetOrderId(foo) {
    throw new Error(`depricated`);
  }
  print_percentages_for_user({ current_price } = {}) {
    try {
      let { buy_price, stop_price, target_price, trading_rules } = this;
      if (current_price) {
        assert(BigNumber.isBigNumber(current_price));
        buy_price = current_price;
      }
      if (this.trading_rules) {
        this.logger.info(
          `Max portfolio loss per trade: ${this.trading_rules.max_allowed_portfolio_loss_percentage_per_trade}%`
        );
      }
      if (buy_price && buy_price.isZero()) {
        this.logger.info(
          "Skipping printing percentages as buy price is unknown"
        );
        return;
      }
      this.algo_utils.calculate_percentages({
        buy_price,
        stop_price,
        target_price,
        trading_rules
      });
    } catch (error) {
      this.logger.warn(error); // eat the error, this is non-essential
    }
  }

  shutdown_streams() {
    if (this.closeUserWebsocket || this.closeTradesWebSocket)
      this.logger.info(`Shutting down streams`);
    if (this.closeUserWebsocket) this.closeUserWebsocket();
    if (this.closeTradesWebSocket) this.closeTradesWebSocket();
  }

  async size_position(
    { current_price, position_sizer_options } = { position_sizer_options: {} }
  ) {
    if (current_price) current_price = BigNumber(current_price); // rare usage, be resilient
    let {
      trading_rules,
      auto_size,
      stop_price,
      buy_price,
      quote_currency,
      max_quote_amount_to_buy,
      base_amount_to_buy
    } = this;

    // this is kind of a corner case when the base_amount is specified for a buy order
    // Do we want the position sizer to fiqure out if we have enough quote to buy that much
    // base? For the moment as Algos are unlikely to use this we just return it directly, the
    // user will see on the command line if there was an issue
    if (base_amount_to_buy) {
      return { base_amount: base_amount_to_buy };
    }

    if (buy_price.isZero() && !current_price) {
      this.logger.info(`Sizing market buy using current market price.`);
      let prices = await this.ee.prices();
      current_price = BigNumber(prices[this.pair]);
    }

    buy_price = current_price ? current_price : buy_price;
    assert(buy_price);
    try {
      let {
        base_amount,
        quote_volume
      } = await this.position_sizer.size_position(
        Object.assign(
          {
            trading_rules,
            auto_size,
            buy_price,
            stop_price,
            quote_currency,
            max_quote_amount_to_buy
          },
          position_sizer_options
        )
      );
      assert(base_amount);
      this.logger.info(
        `Sized trade at ${quote_volume} ${this.quote_currency}, ${base_amount} ${this.base_currency}`
      );
      return { quote_volume, base_amount };
    } catch (error) {
      async_error_handler(this.logger, `sizing position`, error);
    }
  }

  async _create_limit_buy_order() {
    try {
      assert(!(await this.trade_state.get_buyOrderId()));
      assert(this.buy_price && !this.buy_price.isZero());
      let price = this.buy_price;
      let { base_amount } = await this.size_position();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        price
      });
      let response = await this.algo_utils.create_limit_buy_order({
        pair: this.pair,
        base_amount,
        price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Buy error: ${error.body}`, error);
    }
  }

  async _create_limit_sell_order({ price, base_amount } = {}) {
    assert(price);
    assert(base_amount);
    try {
      base_amount = await this.trade_status.get_base_amount_held();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        price
      });
      let response = await this.algo_utils.create_limit_sell_order({
        pair: this.pair,
        base_amount,
        price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Sell error: ${error.body}`, error);
    }
  }

  async _create_stop_loss_limit_sell_order(
    { limit_price_factor } = { limit_price_factor: BigNumber("0.8") }
  ) {
    try {
      assert(limit_price_factor);
      assert(this.stop_price);
      let base_amount = await this.trade_status.get_base_amount_held();
      assert(base_amount_held);
      assert(!base_amount_held.isZero());
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        stop_price: this.stop_price
      });
      let price = this.limit_price;
      if (!price) {
        this.logger.warn(
          `STOP_LIMIT_SELL order using default limit_price_factor of ${limit_price_factor}`
        );
        price = this.stop_price.times(limit_price_factor);
        // TODO: when this line was missing it caused a failure that I couldn't replicate in the tests:
        // -----------------------------
        // STOP_LIMIT_SELL order using default limit_price_factor of 0.8
        // KNCBTC Creating STOP_LOSS_LIMIT SELL ORDER for 2225 at 0.000027296 triggered at 0.00003412
        // SHIT: error placing orders for pair KNCBTC: error
        // { Error: Precision is over the maximum defined for this asset.
        //     at /Users/ryan/Dropbox/crypto/binance-tool/node_modules/binance-api-node/dist/http.js:51:19
        //     at processTicksAndRejections (internal/process/next_tick.js:81:5)
        //   actual_name: 'AsyncErrorWrapper',
        //   name: 'Error',
        //   wrapped: true,
        //   message:
        //    '[AsyncErrorWrapper of Error] Precision is over the maximum defined for this asset.' }
        // SHIT: error placing orders for pair KNCBTC: error
        price = utils.munge_and_check_price({
          exchange_info: this.exchange_info,
          symbol: this.pair,
          price
        });
      }
      let response = await this.algo_utils.create_stop_loss_limit_sell_order({
        pair: this.pair,
        base_amount,
        price,
        stop_price: this.stop_price
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Sell error: ${error.body}`, error);
    }
  }

  async _create_market_buy_order() {
    try {
      assert(!(await this.trade_state.get_buyOrderId()));
      let { base_amount } = await this.size_position();
      base_amount = this._munge_amount_and_check_notionals({
        base_amount,
        buy_price: this.buy_price
      });
      let response = await this.algo_utils.create_market_buy_order({
        base_amount,
        pair: this.pair
      });
      return response.orderId;
    } catch (error) {
      async_error_handler(this.logger, `Buy error: ${error.body}`, error);
    }
  }
  async monitor_user_stream() {
    let obj = this;
    async function checkOrderFilled(data, orderFilled) {
      const {
        symbol,
        price,
        quantity,
        side,
        orderType,
        orderId,
        orderStatus,
        orderRejectReason
      } = data;

      obj.logger.info(
        `${symbol} ${side} ${orderType} ORDER #${orderId} (${orderStatus})`
      );
      obj.logger.info(`..price: ${price}, quantity: ${quantity}`);

      if (orderStatus === "NEW" || orderStatus === "PARTIALLY_FILLED") {
        return;
      }

      if (orderStatus === "CANCELED" && orderRejectReason === "NONE") {
        // Assume user cancelled order and exit
        obj.execution_complete(
          `Order was cancelled, presumably by user. Exiting.`,
          1
        );
        return;
      }

      if (orderStatus !== "FILLED") {
        throw new Error(`Order ${orderStatus}. Reason: ${data.r}`);
      }

      try {
        await orderFilled(data);
      } catch (error) {
        async_error_handler(
          obj.logger,
          `error placing order: ${error.body}`,
          error
        );
      }
    }

    this.closeUserWebsocket = await this.ee.ws.user(async data => {
      try {
        const { orderId, eventType } = data;
        if (eventType !== "executionReport") {
          return;
        }

        if (orderId === (await this.trade_state.get_buyOrderId())) {
          await checkOrderFilled(data, async () => {
            await this.trade_state.set_buyOrderId(undefined);
            // TODO: this should perhaps be an atomic add?... or maybe not?
            await this.trade_status.set_base_amount_held(
              BigNumber(data.totalTradeQuantity)
            );
            this.send_message(`${data.symbol} buy order filled`);
            await obj.placeSellOrder();
          });
        } else if (orderId === (await this.trade_state.get_stopOrderId())) {
          await checkOrderFilled(data, async () => {
            this.send_message(`${data.symbol} stop loss order filled`);
            obj.execution_complete(`Stop hit`, 1);
          });
        } else if (orderId === (await this.trade_state.get_targetOrderId())) {
          await checkOrderFilled(data, async () => {
            this.send_message(`${data.symbol} target sell order filled`);
            obj.execution_complete(`Target hit`);
          });
        }
      } catch (error) {
        let msg = `SHIT: error placing orders for pair ${this.pair}: error`;
        this.logger.error(msg);
        this.logger.error(error);
        this.send_message(msg);
      }
    });
  }

  execution_complete(msg, exit_code = 0) {
    this.logger.info(`ExecutionComplete: ${msg}`);
    this.trade_state.set_trade_completed(true);
    if (exit_code) process.exitCode = exit_code;
    this.shutdown_streams();
  }

  _munge_amount_and_check_notionals({ base_amount }) {
    let { pair, buy_price, stop_price, target_price, limit_price } = this;
    assert(base_amount);
    if (buy_price && buy_price.isZero()) buy_price = undefined;
    return this.algo_utils.munge_amount_and_check_notionals({
      pair,
      base_amount,
      buy_price,
      stop_price,
      target_price,
      limit_price
    });
  }

  async placeStopOrder() {
    try {
      this.logger.warn(
        `Need to add code to create a market sell if STOP_LOSS_LIMIT order is rejected by exchange.`
      );
      let orderId = await this._create_stop_loss_limit_sell_order();
      this.logger.info(`order id: ${orderId}`);
      return orderId;
    } catch (error) {
      async_error_handler(
        this.logger,
        `error placing order: ${error.body}`,
        error
      );
    }
  }

  async placeTargetOrder() {
    try {
      return await this._create_limit_sell_order({
        price: this.target_price,
        base_amount: await this.trade_state.get_base_amount_held()
      });
    } catch (error) {
      async_error_handler(
        this.logger,
        `error placing target sell order: ${error.body}`,
        error
      );
    }
  }

  async placeSellOrder() {
    if (this.stop_price) {
      try {
        await this.trade_state.set_stopOrderId(await this.placeStopOrder());
      } catch (error) {
        async_error_handler(
          this.logger,
          `error placing order: ${error.body}`,
          error
        );
      }
    } else if (this.target_price) {
      try {
        await this.trade_state.set_targetOrderId(await this.placeTargetOrder());
      } catch (error) {
        async_error_handler(
          this.logger,
          `error placing order: ${error.body}`,
          error
        );
      }
    } else {
      this.execution_complete("buy completed and no sell actions defined");
    }
  }

  async main() {
    try {
      this.exchange_info = await this.ee.exchangeInfo();
      this.algo_utils.set_exchange_info(this.exchange_info);
    } catch (error) {
      async_error_handler(
        this.logger,
        "Error could not pull exchange info",
        error
      );
    }

    try {
      let exchange_info = this.exchange_info;
      let symbol = this.pair;

      if (this.buy_price) {
        // buy_price of zero is special case to denote market buy
        if (!this.buy_price.isZero()) {
          this.buy_price = utils.munge_and_check_price({
            exchange_info,
            symbol,
            price: this.buy_price
          });
        }
      }

      if (this.stop_price) {
        this.stop_price = utils.munge_and_check_price({
          exchange_info,
          symbol,
          price: this.stop_price
        });
      }

      if (this.target_price) {
        this.target_price = utils.munge_and_check_price({
          exchange_info,
          symbol,
          price: this.target_price
        });
      }

      this.print_percentages_for_user();
      if (this.percentages) {
        process.exit();
      }

      let buy_msg = this.buy_price ? `buy: ${this.buy_price}` : "";
      let stop_msg = this.stop_price ? `stop: ${this.stop_price}` : "";
      let target_msg = this.target_price ? `target: ${this.target_price}` : "";
      this.send_message(
        `${this.pair} New trade: ${buy_msg} ${stop_msg} ${target_msg}`
      );
      await this.monitor_user_stream();
    } catch (error) {
      this.logger.error(error);
      // throw new Error(`exception in setup code: ${error}`);
      async_error_handler(
        undefined,
        `exception in setup code: ${error.body}`,
        error
      );
    }

    try {
      let waiting_for_soft_entry_price = false;
      if (this.buy_price) {
        if (this.buy_price.isZero()) {
          if (this.soft_entry) {
            let msg = `Soft entry mode requires specified buy price`;
            this.logger.error(msg);
            throw new Error(msg);
          }
          await this.trade_state.set_buyOrderId(
            await this._create_market_buy_order()
          );
        } else {
          if (this.soft_entry) {
            this.logger.info(
              `Soft entry mode: waiting for entry price before placing order`
            );
            waiting_for_soft_entry_price = true;
          } else {
            await this.trade_state.set_buyOrderId(
              await this._create_limit_buy_order()
            );
          }
        }
      } else {
        await this.placeSellOrder();
      }

      let isCancelling = false;

      // TODO: we don't always need this - only if we have stop and target orders that need monitoring
      // or we are monitoring for a soft_entry buy price. Soft entry means don't create buy
      // order until until buy_price is hit
      // TODO: in some cases we could close this stream when we no longer need it
      if ((this.stop_price && this.target_price) || this.soft_entry) {
        let obj = this;
        let report_when_target_price_hit = true;
        let report_when_stop_price_hit = true;
        this.closeTradesWebSocket = await this.ee.ws.aggTrades(
          [this.pair],
          async function(trade) {
            var { symbol, price } = trade;
            assert(symbol);
            assert(price);
            price = BigNumber(price);
            if (waiting_for_soft_entry_price) {
              if (
                price.isLessThanOrEqualTo(
                  obj.soft_entry_buy_order_trigger_price
                )
              ) {
                waiting_for_soft_entry_price = false;
                obj.send_message(
                  `${symbol} soft entry buy order trigger price hit`
                );
                await obj.trade_state.set_buyOrderId(
                  await obj._create_limit_buy_order()
                );
              }
            } else if (await obj.trade_state.get_buyOrderId()) {
              // obj.logger.info(`${symbol} trade update. price: ${price} buy: ${obj.buy_price}`);
            } else if (
              (await obj.trade_state.get_stopOrderId()) ||
              (await obj.trade_state.get_targetOrderId())
            ) {
              // obj.logger.info(
              // 	`${symbol} trade update. price: ${price} stop: ${obj.stop_price} target: ${obj.target_price}`
              // );
              if (
                typeof obj.target_price !== "undefined" &&
                price.isGreaterThanOrEqualTo(obj.target_price) &&
                report_when_target_price_hit
              ) {
                report_when_target_price_hit = false;
                let msg = `${symbol} target price hit`;
                obj.logger.info(msg);
                obj.send_message(msg);
              }
              if (
                typeof obj.stop_price !== "undefined" &&
                price.isLessThanOrEqualTo(obj.stop_price) &&
                report_when_stop_price_hit
              ) {
                report_when_stop_price_hit = false;
                let msg = `${symbol} stop price hit`;
                obj.logger.info(msg);
                obj.send_message(msg);
              }
              if (
                typeof obj.target_price !== "undefined" &&
                (await obj.trade_state.get_stopOrderId()) &&
                !(await obj.trade_state.get_targetOrderId()) &&
                price.isGreaterThanOrEqualTo(obj.target_price) &&
                !isCancelling
              ) {
                {
                  let msg = `Event: price >= target_price: cancelling stop and placeTargetOrder()`;
                  obj.logger.info(msg);
                  obj.send_message(msg);
                }
                isCancelling = true;
                try {
                  let stopOrderId = await obj.trade_state.get_stopOrderId();
                  await obj.trade_state.set_stopOrderId(undefined); // Do before await cancelOrder
                  await obj.ee.cancelOrder({ symbol, orderId: stopOrderId });
                  isCancelling = false;
                } catch (error) {
                  obj.logger.error(`${symbol} cancel error:`, error.body);
                  obj.logger.error(error);
                  return;
                }
                try {
                  await obj.trade_state.set_targetOrderId(
                    await obj.placeTargetOrder()
                  );
                } catch (error) {
                  async_error_handler(
                    obj.logger,
                    `error placing order: ${error.body}`,
                    error
                  );
                }
              } else if (
                (await obj.trade_state.get_targetOrderId()) &&
                !(await obj.trade_state.get_stopOrderId()) &&
                price.isLessThanOrEqualTo(obj.stop_price) &&
                !isCancelling
              ) {
                isCancelling = true;
                try {
                  let targetOrderId = await obj.trade_state.get_targetOrderId();
                  await obj.trade_state.set_targetOrderId(undefined); // Do before await cancelOrder
                  await obj.ee.cancelOrder({ symbol, orderId: targetOrderId });
                  isCancelling = false;
                } catch (error) {
                  obj.logger.error(`${symbol} cancel error:`, error.body);
                  return;
                }
                obj.logger.info(`${symbol} cancel response:`, response);
                try {
                  await obj.trade_state.set_stopOrderId(
                    await obj.placeStopOrder()
                  );
                } catch (error) {
                  async_error_handler(
                    obj.logger,
                    `error placing order: ${error.body}`,
                    error
                  );
                }
              }
            }
          }
        );
      }
    } catch (error) {
      async_error_handler(
        this.logger,
        `exception in main loop: ${error.body}`,
        error
      );
    }
  }
}

module.exports = TradeExecutor;
