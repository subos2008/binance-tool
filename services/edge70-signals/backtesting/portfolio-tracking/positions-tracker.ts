import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ContextTags, SendMessageFunc } from "../../../../interfaces/send-message"
import {
  check_func,
  SpotPositionTracker,
} from "../../../amqp/binance-order-data/position-tracker/position-tracker"
import { Logger } from "../../../../lib/faux_logger"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { SpotPositionsPersistence } from "../../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { RedisClient } from "redis"
import { GenericOrderData } from "../../../../types/exchange_neutral/generic_order_data"
import {
  SpotPositionCallbacks,
  SpotPositionClosedEvent_V1,
  SpotPositionOpenedEvent_V1,
} from "../../../../classes/spot/abstractions/spot-position-callbacks"

// return true if the position size passed it would be considered an untradeably small balance on the exchange
let close_position_check_func: check_func = function ({
  market_symbol,
  volume,
  price,
}: {
  market_symbol: string
  volume: BigNumber
  price: BigNumber
}): boolean {
  let result: boolean = volume.isZero()
  return result
}

export class BacktesterSpotPostionsTracker implements SpotPositionCallbacks {
  logger: Logger
  positions_tracker: SpotPositionTracker
  spot_positions_query: SpotPositionsQuery
  position_closed_events: { [base_asset: string]: SpotPositionClosedEvent_V1[] } = {}

  constructor({
    send_message,
    logger,
    redis,
    spot_positions_query,
    spot_positions_persistance,
    health_and_readiness,
  }: {
    send_message: SendMessageFunc
    logger: Logger
    redis: RedisClient
    spot_positions_query: SpotPositionsQuery
    spot_positions_persistance: SpotPositionsPersistence
    health_and_readiness: HealthAndReadiness
  }) {
    this.logger = logger
    this.spot_positions_query = spot_positions_query
    this.positions_tracker = new SpotPositionTracker({
      send_message,
      logger,
      redis,
      close_position_check_func,
      spot_positions_query,
      spot_positions_persistance,
      health_and_readiness,
      callbacks: this,
    })
  }

  async buy_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    this.positions_tracker.buy_order_filled({ generic_order_data })
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    this.positions_tracker.sell_order_filled({ generic_order_data })
  }

  async in_position(args: { base_asset: string; edge: string }): Promise<boolean> {
    return this.spot_positions_query.in_position(args)
  }

  async position_size(args: { base_asset: string; edge: string }): Promise<BigNumber> {
    return this.spot_positions_query.exisiting_position_size(args)
  }

  async on_position_opened(event: SpotPositionOpenedEvent_V1): Promise<void> {
    this.logger.error(
      `oooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo`
    )
    let { base_asset } = event
    this.logger.info(`${base_asset}: Opened position ${event.initial_entry_position_size}}%`)
  }

  async on_position_closed(event: SpotPositionClosedEvent_V1): Promise<void> {
    this.logger.error(
      `FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF`
    )
    let { base_asset } = event
    this.logger.info(`${base_asset}: Closed position ${event.percentage_quote_change}%`)
    if (!this.position_closed_events[base_asset]) this.position_closed_events[base_asset] = []
    this.position_closed_events[base_asset].push(event)
  }

  async summary() {
    type E = SpotPositionClosedEvent_V1

    try {
      for (const base_asset in this.position_closed_events) {
        let events = this.position_closed_events[base_asset]

        let prefix = (n: number) => (n < 0 ? `LOSS ` : `WIN +`)

        let to_string = (e: E) => {
          if (!e.abs_quote_change) throw new Error(`abs_quote_change missing`)
          if (!e.percentage_quote_change) throw new Error(`percentage_quote_change missing`)
          return prefix(e.percentage_quote_change) + `[A:${e.abs_quote_change} P]`
        }

        let reducer = (prev: BigNumber, e: E) => {
          if (!e.percentage_quote_change) throw new Error(`percentage_quote_change missing`)
          let to_factor = (n: number) => 1 + n / 100
          return prev.times(to_factor(e.percentage_quote_change))
        }

        let strings = this.position_closed_events[base_asset].map(to_string)
        let final: string = events.reduce(reducer, new BigNumber(1)).dp(1).toFixed()
        this.logger.info(`${base_asset}: ` + strings.join(", ") + ` FINAL: x${final}`)
      }
    } catch (err) {
      this.logger.error({ err })
      this.logger.error(err as any)
      throw err
    }
  }
}
