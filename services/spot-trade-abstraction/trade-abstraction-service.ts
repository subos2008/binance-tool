import { Logger } from "../../interfaces/logger"
import { strict as assert } from "assert"
import { Positions } from "./positions"
import { MarketIdentifier_V3 } from "../../events/shared/market-identifier"
import { SendMessageFunc } from "../../lib/telegram-v2"

export interface TradeAbstractionGoLongCommand {
  base_asset: string
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
  private positions: Positions // query state of existing open positions

  constructor({
    logger,
    send_message,
    quote_asset,
    positions,
  }: {
    logger: Logger
    send_message: SendMessageFunc
    quote_asset: string
    positions: Positions
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
  go_spot_long(cmd: TradeAbstractionGoLongCommand, send_message: (msg: string) => void) {
    // let market: MarketIdentifier_V3 = this.positions.get_market_identifier_for({
    //   quote_asset: this.quote_asset,
    //   base_asset: cmd.base_asset,
    // })

    // /** We want this check and entry to be atomic, while we only trade one edge it's less important */
    // let existing_position = this.positions.in_position(market) // this should be an array - actually no becuase we give a MarketIdentifier_V3 which should be unique per account

    // if (existing_position) {
    //   if (existing_position.direction == "long") {
    //     let msg = `Already in long spot position on ${cmd.base_asset}, skipping`
    //     this.logger.warn(msg)
    //     send_message(msg)
    //     throw new Error(msg)
    //   } else {
    //     throw new Error(
    //       `Unexpected direction ${existing_position.direction} in existing spot position for ${market.symbol}`
    //     )
    //   }
    // }
    // let quote_amount = this.position_size()
    // // this.ee.market_buy_spot({
    // //   //   base_amount,
    // //   pair: market.symbol,
    // //   //   orderId,
    // // })
    // this.positions.open_positions()
  }

  async open_positions() {
    return this.positions.open_positions()
  }
}
