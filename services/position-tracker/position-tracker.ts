import { strict as assert } from "assert"

import { RedisClient } from "redis"

import { Logger } from "../../interfaces/logger"
import { GenericOrderData } from "../../types/exchange_neutral/generic_order_data"
import { RedisPositionsState } from "../../classes/persistent_state/redis_positions_state"
import { PositionPublisher } from "../../classes/amqp/positions-publisher"

import BigNumber from "bignumber.js"
import { timeStamp } from "console"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import * as Sentry from "@sentry/node"
import { PositionIdentifier } from "../../events/shared/position-identifier"
import { Position } from "../../classes/position"

type check_func = ({ volume, symbol: string }: { price: BigNumber; volume: BigNumber; symbol: string }) => boolean
export class PositionTracker {
  send_message: Function
  logger: Logger
  positions_state: RedisPositionsState
  position_publisher: PositionPublisher
  close_position_check_func: check_func

  constructor({
    send_message,
    logger,
    redis,
    close_position_check_func,
  }: {
    send_message: (msg: string) => void
    logger: Logger
    redis: RedisClient
    close_position_check_func: check_func
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.positions_state = new RedisPositionsState({ logger, redis })
    this.position_publisher = new PositionPublisher({
      logger,
      send_message,
      broker_name: "binance",
    })
    assert(close_position_check_func)
    this.close_position_check_func = close_position_check_func
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      symbol,
      exchange,
      account,
      averageExecutionPrice,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity,
    } = generic_order_data
    if (!account) account = "default"
    let position_size: BigNumber | null = await this.positions_state.get_position_size({
      exchange,
      account,
      symbol,
    })

    // 1. Is this a new position?
    if (position_size.isZero()) {
      try {
        this.send_message(`New position for ${symbol}`)
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol)
          scope.setTag("exchange", exchange)
          if (account) scope.setTag("account", account)
          Sentry.captureException(error)
        })
      }

      // 1.1 create a new position and record the entry price and timestamp
      let initial_entry_price: BigNumber | undefined
      try {
        initial_entry_price = averageExecutionPrice ? new BigNumber(averageExecutionPrice) : undefined
        this.positions_state.create_new_position(
          { symbol, exchange, account },
          {
            position_size: new BigNumber(totalBaseTradeQuantity),
            initial_entry_price,
            quote_invested: new BigNumber(totalQuoteTradeQuantity),
          }
        )
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol)
          scope.setTag("exchange", exchange)
          if (account) scope.setTag("account", account)
          Sentry.captureException(error)
        })
      }

      // Publish an event declaring the new position
      try {
        this.position_publisher.publish_new_position_event({
          event_type: "NewPositionEvent",
          exchange_identifier: { exchange, account },
          symbol,
          position_base_size: totalBaseTradeQuantity,
          position_initial_quote_spent: totalQuoteTradeQuantity,
          position_initial_entry_price: initial_entry_price?.toFixed(),
        })
      } catch (error) {
        console.error(error)
        Sentry.withScope(function (scope) {
          scope.setTag("symbol", symbol)
          scope.setTag("exchange", exchange)
          if (account) scope.setTag("account", account)
          Sentry.captureException(error)
        })
      }
    } else {
      // 1.2 if existing position just increase the position size
      // not sure what do do about entry price adjustments yet
      this.send_message(`Existing position found for ${symbol}, size ${position_size}`)
      // TODO: Fuck, what is the quote currency is different on the buy/sell?
      // TODO: positions aren't in pairs (symbols) they are in base currencies.
      this.positions_state.adjust_position_size_by(
        { symbol, exchange, account },
        {
          base_change: new BigNumber(totalBaseTradeQuantity),
          quote_change: new BigNumber(totalQuoteTradeQuantity).negated(),
        }
      )
      position_size = null // invalidated as needs re-loading from state
    }

    // 3. Fire a position changed event or call a callback so we can add auto-exit 10@10 orders
    // A new service called trading-rules-auto-position-exits
  }

  private async load_position_for_order(generic_order_data: GenericOrderData): Promise<Position> {
    let { symbol, exchange, account, averageExecutionPrice } = generic_order_data

    if (!account) account = "default" // TODO
    let position_identifier: PositionIdentifier = {
      exchange_identifier: { exchange, account },
      symbol,
    }
    let position = new Position({
      logger: this.logger,
      redis_positions: this.positions_state,
      position_identifier,
    })
    let prices: { [key: string]: string } = {}
    if (averageExecutionPrice) prices[symbol] = averageExecutionPrice
    await position.load_and_init({ prices })
    return position
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    let {
      symbol,
      exchange,
      account,
      averageExecutionPrice,
      totalBaseTradeQuantity,
      totalQuoteTradeQuantity, // TODO: use this
    } = generic_order_data

    if (!account) account = "default" // TODO
    let position_size: BigNumber = await this.positions_state.get_position_size({
      exchange,
      account,
      symbol,
    })

    // 1. Is this an existing position?
    if (position_size.isZero()) {
      this.send_message(`Sell executed on unknown position for ${symbol}`)
      return // this is our NOP
    }

    // 1.2 if existing position decrease the position size or close the position
    // TODO: also maintain net quote
    let msg = `reduced the position size for ${symbol}`
    this.send_message(msg)

    position_size = position_size.minus(totalBaseTradeQuantity)
    await this.positions_state.adjust_position_size_by(
      { symbol, exchange, account },
      {
        base_change: new BigNumber(totalBaseTradeQuantity).negated(),
        quote_change: new BigNumber(totalQuoteTradeQuantity),
      }
    )

    if (!averageExecutionPrice) {
      // TODO: set sentry context after unpacking the order (withScope)
      let msg = `averageExecutionPrice not supplied, unable to determine if ${symbol} position should be closed.`
      Sentry.captureMessage(msg)
      this.send_message(msg)
      return
    }

    // 1.3
    if (
      this.close_position_check_func({
        symbol,
        volume: position_size,
        price: new BigNumber(averageExecutionPrice),
      })
    ) {
      this._close_position(await this.load_position_for_order(generic_order_data))
    }
  }

  private async _close_position(position: Position) {
    let msg = `${position.symbol} traded from ${position.initial_entry_price} to ${
      position.current_price
    }: ${position.percentage_price_change_since_initial_entry?.dp(1)}% change.`
    this.send_message(msg)

    this.positions_state.close_position(position.tuple).then(() => {
      this.send_message(`closed position: ${position.symbol}`)
    })
  }
}
