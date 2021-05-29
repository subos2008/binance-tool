import { strict as assert } from "assert"
import { Logger } from "../interfaces/logger"

import * as Sentry from "@sentry/node"

import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state"
import { PositionIdentifier } from "../events/shared/position-identifier"

import * as _ from "lodash"

/*
{ exchange: 'binance', account: 'default', symbol: 'XTZBNB' }
{
  position_size: 783.8,
  initial_entry_price: 0.00988,
  netQuoteBalanceChange: -6.121648
}
*/

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

export class Position {
  logger: Logger
  ee: any
  redis_positions: RedisPositionsState
  position_identifier: PositionIdentifier
  object: any | undefined
  prices: { [key: string]: string } = {}

  constructor({
    logger,
    redis_positions,
    position_identifier,
  }: {
    logger: Logger
    redis_positions: RedisPositionsState
    position_identifier: PositionIdentifier
  }) {
    this.logger = logger
    this.redis_positions = redis_positions
    this.position_identifier = position_identifier
  }

  get tuple() {
    return {
      baseAsset: this.baseAsset,
      exchange: this.position_identifier.exchange_identifier.exchange,
      account: this.position_identifier.exchange_identifier.account,
    }
  }

  get baseAsset(): string {
    return this.position_identifier.baseAsset
  }

  get initial_entry_price(): BigNumber | null {
    return new BigNumber(this.object?.initial_entry_price)
  }

  // TODO: avg entry price derived from netQuote change and position size?
  // then make sure netQuote change is tracked properly

  // Depricated, needs a quoteAsset to compare with
  // get current_price(): BigNumber | undefined {
  //   return this.prices[this.symbol] ? new BigNumber(this.prices[this.symbol]) : undefined
  // }

  get position_size(): BigNumber | undefined {
    return this.object?.position_size ? new BigNumber(this.object.position_size) : undefined
  }

  // Depricated, needs a quoteAsset to compare with
  // get percentage_price_change_since_initial_entry(): BigNumber | undefined {
  //   if (!this.initial_entry_price) throw new Error(`initial_entry_price unknown`)
  //   if (!this.current_price) throw new Error(`current_price unknown`)
  //   return this.current_price.minus(this.initial_entry_price).dividedBy(this.initial_entry_price).times(100)
  // }

  async load_and_init({ prices }: { prices: { [key: string]: string } }) {
    this.prices = prices
    this.object = await this.describe_position()
  }

  async describe_position(): Promise<{
    position_size: BigNumber | undefined
    initial_entry_price: BigNumber | undefined
    netQuoteBalanceChange: BigNumber | undefined
    current_price?: string
  }> {
    const object: any = this.redis_positions.describe_position(this.position_identifier)
    // if (this.prices) object.current_price = this.current_price
    return object
  }

  asObject(): string {
    return Object.assign({}, this.object, {
      // position_identifier: this.position_identifier,
      // current_price: this.current_price,
    })
  }
}
