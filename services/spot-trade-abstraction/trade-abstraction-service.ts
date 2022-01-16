import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { SpotPositions } from "./spot-positions"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { SendMessageFunc } from "../../lib/telegram-v2"
import { SpotPositionIdentifier } from "./spot-interfaces"

export interface TradeAbstractionGoLongCommand {
  base_asset: string
  edge: string
  direction: "long"
}

// Mehran wants us to have 30-50% stop on Edge60
// Plan is Edge60 for selected major markets
// and edge59 for alts generally

/**
 * Convert "go long" / "go short" signals into ExecutionEngine commands
 */
export class TradeAbstractionService {
  logger: Logger
  send_message: SendMessageFunc
  quote_asset: string
  private positions: SpotPositions // query state of existing open positions

  constructor({
    logger,
    send_message,
    quote_asset,
    positions,
  }: {
    logger: Logger
    send_message: SendMessageFunc
    quote_asset: string
    positions: SpotPositions
  }) {
    assert(logger)
    this.logger = logger
    assert(quote_asset)
    this.quote_asset = quote_asset
    this.positions = positions
    this.send_message = send_message
  }

  // or signal_long
  // Spot so we can only be long or no-position
  async go_spot_long(cmd: TradeAbstractionGoLongCommand, send_message: (msg: string) => void) {
    assert.equal(cmd.direction, "long")
    /** TODO: We want this check and entry to be atomic, while we only trade one edge it's less important */
    this.logger.warn(`Position entry is not atomic with check for existing position`)
    let existing_spot_position_size: BigNumber = await this.positions.exisiting_position_size({
      base_asset: cmd.base_asset,
    })

    if (existing_spot_position_size.isGreaterThan(0)) {
      let msg = `Already in long spot position on ${cmd.base_asset}, skipping`
      this.logger.warn(msg)
      send_message(msg)
      throw new Error(msg) // turn this into a 3xx or 4xx
    }

    this.positions.open_position({ quote_asset: this.quote_asset, ...cmd })
  }

  async open_positions(): Promise<SpotPositionIdentifier[]> {
    return this.positions.open_positions()
  }
}
