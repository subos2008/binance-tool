import { strict as assert } from "assert";
import { Logger } from "../interfaces/logger";

import * as Sentry from "@sentry/node";

import { RedisPositionsState } from "../classes/persistent_state/redis_positions_state";
import { PositionIdentifier } from "../events/shared/position-identifier";

/*
{ exchange: 'binance', account: 'default', symbol: 'XTZBNB' }
{
  position_size: 783.8,
  initial_entry_price: 0.00988,
  netQuoteBalanceChange: -6.121648
}
*/

import { BigNumber } from "bignumber.js";
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!");
};

export class Position {
  logger: Logger;
  ee: any;
  redis_positions: RedisPositionsState;
  position_identifier: PositionIdentifier;
  object: any | undefined;
  prices: { [key: string]: string } = {};

  constructor({
    logger,
    redis_positions,
    position_identifier,
  }: {
    logger: Logger;
    redis_positions: RedisPositionsState;
    position_identifier: PositionIdentifier;
  }) {
    this.logger = logger;
    this.redis_positions = redis_positions;
    this.position_identifier = position_identifier;
  }

  get symbol(): string {
    return this.position_identifier.symbol;
  }

  get initial_entry_price(): BigNumber | null {
    return new BigNumber(this.object?.initial_entry_price);
  }

  get current_price(): BigNumber | undefined {
    return new BigNumber(this.prices[this.symbol]);
  }

  get percentage_price_change_since_initial_entry(): BigNumber | undefined {
    if(!this.initial_entry_price) throw new Error(`initial_entry_price unknown`)
    if(!this.current_price) throw new Error(`current_price unknown`)
    return this.current_price.minus(this.initial_entry_price).dividedBy(this.initial_entry_price).times(100)
  }

  async load_and_init({ prices }: { prices: { [key: string]: string } }) {
    this.prices = prices;
    this.object = await this.describe_position();
  }

  async describe_position(): Promise<{
    position_size: BigNumber | undefined;
    initial_entry_price: BigNumber | undefined;
    netQuoteBalanceChange: BigNumber | undefined;
    current_price?: string;
  }> {
    const object: any = this.redis_positions.describe_position(
      this.position_identifier
    );
    if (this.prices) object.current_price = this.current_price;
    return object;
  }
}
