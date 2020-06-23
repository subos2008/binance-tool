const async_error_handler = require("./async_error_handler");
import { strict as assert } from 'assert';
import { PositionSizer } from "./position_sizer"
import { AlgoUtils } from "../service_lib/algo_utils"

import { Logger } from '../interfaces/logger'
import { TradeState } from '../classes/persistent_state/redis_trade_state'
import { TradeDefinition } from '../classes/specifications/trade_definition'
import { TradingRules } from '../lib/trading_rules'
import { TradeOrderCreator } from '../classes/trade_order_creator'
import { TradePriceRangeTracker } from '../classes/trade_price_range_tracker'

import BigNumber from 'bignumber.js';
import { OrderExecutionTracker } from "../service_lib/order_execution_tracker";
import { OrderState } from "../classes/persistent_state/redis_order_state";
import { BinanceOrderData } from '../interfaces/order_callbacks'
import { PriceRanges } from "../classes/specifications/price_ranges";

import * as Sentry from '@sentry/node';

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

var util = require('util');

export class TradeExecutor {
  logger: Logger
  send_message: (msg: string) => void
  ee: any
  exchange_info: any
  trade_state: TradeState
  order_state: OrderState
  trading_rules: TradingRules
  trade_definition: TradeDefinition
  price_ranges: PriceRanges
  algo_utils: AlgoUtils
  position_sizer: PositionSizer
  closeUserWebsocket: (() => void) | null
  trade_order_creator: TradeOrderCreator | null
  trade_price_range_tracker: TradePriceRangeTracker | null
  order_execution_tracker: OrderExecutionTracker | null

  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    trade_state,
    order_state,
    trade_definition,
    percentage_before_soft_buy_price_to_add_order = new BigNumber("0.5"),
    trading_rules,
  }: { logger: Logger, ee: any, send_message: (msg: string) => void, trade_state: TradeState, order_state: OrderState, trade_definition: TradeDefinition, percentage_before_soft_buy_price_to_add_order?: BigNumber, trading_rules: TradingRules }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
    assert(ee);
    this.ee = ee;
    assert(trade_definition)
    this.trade_definition = trade_definition
    assert(trade_state);
    this.trade_state = trade_state;
    assert(order_state);
    this.order_state = order_state;
    assert(trading_rules);
    this.trading_rules = trading_rules;
    this.logger.info('Trading Rules:')
    this.logger.info(util.inspect(this.trading_rules))

    this.price_ranges = new PriceRanges({ logger, trade_definition, percentage_before_soft_buy_price_to_add_order })

    this.algo_utils = new AlgoUtils({ logger, ee });
    this.position_sizer = new PositionSizer({ logger, ee, trading_rules });
  }

  shutdown_streams() {
    if (this.closeUserWebsocket) {
      this.logger.info(`Shutting down streams`);
      this.closeUserWebsocket();
      this.closeUserWebsocket = null
    }
    if (this.trade_price_range_tracker) {
      this.trade_price_range_tracker.shutdown_streams()
    }
  }

  async size_position(
    { current_price }: { current_price?: string | BigNumber } = {}
  ) {
    let {
      trading_rules,
    } = this;
    let {
      pair,
      max_quote_amount_to_buy,
      auto_size
    } = this.trade_definition;
    let {
      stop_price,
      buy_price,
    } = this.trade_definition.munged;

    let { quote_currency, base_currency } = this.algo_utils.split_pair(pair);

    if (current_price != null) current_price = new BigNumber(current_price);
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
        )
      );
      assert(base_amount);
      this.logger.info(
        `Sized trade at ${quote_volume.toFixed()} ${quote_currency}, ${base_amount.toFixed()} ${base_currency}`
      );
      return { quote_volume, base_amount };
    } catch (error) {
                Sentry.captureException(error);
                async_error_handler(this.logger, `sizing position`, error);
      throw error
    }
  }

  async order_filled(orderId: string, { totalTradeQuantity, symbol }: { totalTradeQuantity: string, symbol: string }) {
    const { buyOrderId, stopOrderId, targetOrderId } = await this.trade_state.get_order_ids()
    if (orderId == buyOrderId) {
      await this.trade_state.fully_filled_buy_order({ orderId: buyOrderId, total_base_amount_bought: new BigNumber(totalTradeQuantity) })
      this.send_message(`${symbol} buy order filled`);
      if (!this.trade_order_creator) throw new Error(`placeSellOrder called before trade_order_creator is initialised`)
      await this.trade_order_creator.placeSellOrder();
    } else if (orderId == stopOrderId) {
      this.send_message(`${symbol} stop loss order filled`);
      this.execution_complete(`Stop hit`, 1);
    } else if (orderId == targetOrderId) {
      this.send_message(`${symbol} target sell order filled`);
      this.execution_complete(`Target hit`);
    } else {
      console.warn(`Didn't recognise order: ${orderId} [buy: ${buyOrderId} stop: ${stopOrderId} target: ${targetOrderId}]`)
    }
    // TODO: catch: shit failed to update after order state change!
  }

  async order_cancelled(orderId: string, data: BinanceOrderData) {
    if (data.orderRejectReason === "NONE") {
      // Assume user cancelled order and exit
      console.log(`Order ${orderId} was cancelled maybe by user or by engine, taking no action`)
      console.log(data)
      // this.execution_complete(
      //   `Order was cancelled, presumably by user. Exiting.`,
      //   1
      // )
    }
    else {
      throw new Error(`Order #${orderId} cancelled for unknown reason: ${data.orderRejectReason}`)
    }
  }

  execution_complete(msg: string, exit_code = 0) {
    this.logger.info(`ExecutionComplete: ${msg}`);
    this.trade_state.set_trade_completed(true);
    if (exit_code) process.exitCode = exit_code;
    this.shutdown_streams();
  }

  async main() {
    this.exchange_info = await this.ee.exchangeInfo();
    this.algo_utils.set_exchange_info(this.exchange_info);
    this.trade_definition.set_exchange_info(this.exchange_info)
    this.trade_order_creator = new TradeOrderCreator(this.logger, this.trade_definition, this.trade_state, this.algo_utils, this.exchange_info, this)

    this.trade_definition.print_trade_for_user();
    this.send_message(this.trade_definition.get_message())

    // Monitor Binance user stream for completed orders
    this.order_execution_tracker = new OrderExecutionTracker({
      ee: this.ee, // binance-api-node API
      send_message: this.send_message,
      logger: this.logger,
      order_state: this.order_state,
      order_callbacks: this
    })
    await this.order_execution_tracker.main()

    let base_amount_held = await this.trade_state.get_base_amount_held()
    let buyOrderId = await this.trade_state.get_buyOrderId()
    let buying_allowed = await this.trade_state.get_buying_allowed()
    if (
      this.trade_definition.munged.buy_price && (!buyOrderId) && buying_allowed
    ) {
      if (!this.trade_definition.soft_entry) {
        await this.trade_order_creator.placeBuyOrder();
      }
    } else if ((!buyOrderId) && !base_amount_held.isZero()) {
      await this.trade_order_creator.placeSellOrder();
    } else {
      this.logger.error(`WARN: Possible logic error`)
    }


    // we don't always need the price stream monitoring
    // - only if we have stop and target orders that need monitoring
    // or we are monitoring for a soft_entry buy price. 
    // Soft entry means don't the create buy order until until buy_price is hit
    // TODO: in some cases we could close this stream when we no longer need it
    // Use unmunged as we are checking if they were present in the trade_definition
    if ((this.trade_definition.unmunged.stop_price && this.trade_definition.unmunged.target_price) || (this.trade_definition.unmunged.buy_price && this.trade_definition.soft_entry)) {
      this.trade_price_range_tracker = new TradePriceRangeTracker(this.logger, this.send_message, this.trade_definition, this.trade_state, this.price_ranges, this.trade_order_creator, this.ee)
      await this.trade_price_range_tracker.main() // await needed for testing
    }
  }
}
