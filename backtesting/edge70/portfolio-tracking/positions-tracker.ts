import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ContextTags, SendMessageFunc } from "../../../interfaces/send-message"
import {
  check_func,
  SpotPositionTracker,
} from "../../../amqp/binance-order-data/position-tracker/position-tracker"
import { HealthAndReadiness } from "../../../classes/health_and_readiness"
import { SpotPositionsPersistence } from "../../../classes/spot/persistence/interface/spot-positions-persistance"
import { SpotPositionsQuery } from "../../../classes/spot/abstractions/spot-positions-query"
import { RedisClient } from "redis"
import { GenericOrderData } from "../../../types/exchange_neutral/generic_order_data"
import {
  SpotPositionCallbacks,
  SpotPositionClosedEvent_V1,
  SpotPositionOpenedEvent_V1,
} from "../../../classes/spot/abstractions/spot-position-callbacks"
import { ServiceLogger } from "../../../interfaces/logger"

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
  logger: ServiceLogger
  positions_tracker: SpotPositionTracker
  spot_positions_query: SpotPositionsQuery
  position_closed_events: { [base_asset: string]: SpotPositionClosedEvent_V1[] } = {}
  position_opened_events: { [base_asset: string]: SpotPositionOpenedEvent_V1[] } = {}

  constructor({
    send_message,
    logger,
    redis,
    spot_positions_query,
    spot_positions_persistance,
    health_and_readiness,
  }: {
    send_message: SendMessageFunc
    logger: ServiceLogger
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
    await this.positions_tracker.buy_order_filled({ generic_order_data })
  }

  async sell_order_filled({ generic_order_data }: { generic_order_data: GenericOrderData }) {
    await this.positions_tracker.sell_order_filled({ generic_order_data })
  }

  async on_position_opened(event: SpotPositionOpenedEvent_V1): Promise<void> {
    let { base_asset } = event
    if (!this.position_opened_events[base_asset]) this.position_opened_events[base_asset] = []
    this.position_opened_events[base_asset].push(event)
  }

  async on_position_closed(event: SpotPositionClosedEvent_V1): Promise<void> {
    let { base_asset } = event
    if (!this.position_closed_events[base_asset]) this.position_closed_events[base_asset] = []
    this.position_closed_events[base_asset].push(event)
  }

  async summary() {
    type E = SpotPositionClosedEvent_V1

    try {
      for (const base_asset in this.position_closed_events) {
        let events = this.position_closed_events[base_asset]

        let prefix = (n: number) => (n < 0 ? `LOSS ` : `WIN `)
        let sign = (n: number) => (n < 0 ? `${n}` : `+${n}`)
        let pct = (n: number | string) => new BigNumber(n.toString()).dp(1).toNumber()

        let to_string = (e: E) => {
          if (!e.abs_quote_change) throw new Error(`abs_quote_change missing`)
          if (!e.percentage_quote_change) throw new Error(`percentage_quote_change missing`)
          return (
            prefix(e.percentage_quote_change) +
            `[${sign(pct(e.percentage_quote_change))}%]`
          )
        }

        let reducer = (prev: BigNumber, e: E) => {
          if (!e.percentage_quote_change) throw new Error(`percentage_quote_change missing`)
          let to_factor = (n: number) => (1 + n / 100).toString()
          return prev.times(to_factor(e.percentage_quote_change))
        }

        let strings = this.position_closed_events[base_asset].map(to_string)
        let final: string = events.reduce(reducer, new BigNumber(1)).dp(1).toFixed() + `final calc is almost certainly incorrect`
        this.logger.info(`${base_asset}: ` + strings.join(", ") + ` FINAL: x${final}`)
      }
    } catch (err) {
      this.logger.error({ err })
      this.logger.error(err as any)
      throw err
    }
  }
}
