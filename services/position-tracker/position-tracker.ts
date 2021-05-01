import { strict as assert } from 'assert';

import { RedisClient } from 'redis';

import { Logger } from '../../interfaces/logger'
import { GenericOrderData } from '../../types/exchange_neutral/generic_order_data'
import { RedisPositionsState } from '../../classes/persistent_state/redis_positions_state'
import { PositionPublisher } from '../../classes/amqp/position-publisher'

import BigNumber from "bignumber.js";
import { timeStamp } from 'console';
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

import * as Sentry from '@sentry/node';

type check_func = ({ volume, symbol: string }: { price: BigNumber, volume: BigNumber, symbol: string }) => boolean
export class PositionTracker {
  send_message: Function;
  logger: Logger;
  positions_state: RedisPositionsState;
  position_publisher: PositionPublisher
  close_position_check_func: check_func;

  constructor({
    send_message,
    logger, redis, close_position_check_func
  }: { send_message: (msg: string) => void, logger: Logger, redis: RedisClient, close_position_check_func: check_func }) {
    assert(logger);
    this.logger = logger;
    assert(send_message);
    this.send_message = send_message;
    this.positions_state = new RedisPositionsState({ logger, redis })
    this.position_publisher = new PositionPublisher({ logger, send_message, broker_name: 'binance' })
    assert(close_position_check_func)
    this.close_position_check_func = close_position_check_func;
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    // 1. Is this an existing position?
    let { symbol, exchange, account, averageExecutionPrice, totalBaseTradeQuantity, totalQuoteTradeQuantity } = generic_order_data
    if (!account) account = 'default'
    let position_size: BigNumber = await this.positions_state.get_position_size({ exchange, account, symbol })
    if ((await position_size).isZero()) {
      try {
        this.logger.info(`New position for ${symbol}`)
        this.send_message(`New position for ${symbol}`)
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol);
          scope.setTag("exchange", exchange);
          if (account) scope.setTag("account", account);
          Sentry.captureException(error);
        });
      }

      // 1.1 if not, create a new position and record the entry price and timestamp
      try {
        let position_size = new BigNumber(totalBaseTradeQuantity)
        let initial_entry_price = averageExecutionPrice ? new BigNumber(averageExecutionPrice) : undefined
        let netQuoteBalanceChange = new BigNumber(0).minus(totalQuoteTradeQuantity)
        this.positions_state.create_new_position({ symbol, exchange, account }, { position_size, initial_entry_price, quote_invested: netQuoteBalanceChange })
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol);
          scope.setTag("exchange", exchange);
          if (account) scope.setTag("account", account);
          Sentry.captureException(error);
        });
      }

      try {
        this.position_publisher.publish_new_position_event({ event_type: 'NewPositionEvent', exchange_identifier: { exchange, account }, symbol, position_base_size: totalBaseTradeQuantity })
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol);
          scope.setTag("exchange", exchange);
          if (account) scope.setTag("account", account);
          Sentry.captureException(error);
        });
      }
    } else {
      // 1.2 if existing position just increase the position size
      // not sure what do do about entry price adjustments yet
      this.logger.info(`Existing position found for ${symbol}`)
      this.send_message(`Existing position found for ${symbol}, size ${position_size}`)
      this.positions_state.increase_position_size_by({ symbol, exchange, account }, new BigNumber(totalBaseTradeQuantity))
    }

    // 3. Fire a position changed event or call a callback so we can add auto-exit 10@10 orders
    // A new service called trading-rules-auto-position-exits
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    // 1. Is this an existing position?
    let { symbol, exchange, account } = generic_order_data
    if (!account) account = 'default'
    let position_size: BigNumber = await this.positions_state.get_position_size({ exchange, account, symbol })
    if ((position_size).isZero()) {
      let msg = `Sell executed on unknown position for ${symbol}`
      this.logger.error(msg)
      this.send_message(msg)
    } else {
      // 1.2 if existing position just decrease the position size
      // not sure what do do about partial exits atm
      let msg = `reducing the position size for ${symbol}`
      this.logger.info(msg)
      this.send_message(msg)
      let { averageExecutionPrice, totalBaseTradeQuantity, totalQuoteTradeQuantity } = generic_order_data
      position_size = new BigNumber(await this.positions_state.decrease_position_size_by({ symbol, exchange, account }, new BigNumber(totalBaseTradeQuantity)))
      if (averageExecutionPrice) {
        if (this.close_position_check_func({ symbol, volume: position_size, price: new BigNumber(averageExecutionPrice) })) {
          this.positions_state.close_position({ symbol, exchange, account }).then(() => {
            this.send_message(`closed position: ${symbol}`)
          })
        }
      } else {
        Sentry.captureMessage(`averageExecutionPrice not supplied, unable to determine if position should be closed.`)
      }
    }
  }
}

