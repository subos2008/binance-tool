import Sentry from "../../../../lib/sentry"

BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BigNumber } from "bignumber.js"
import { Edge70SignalCallbacks } from "../../interfaces/_internal"
import { HealthAndReadiness } from "../../../../classes/health_and_readiness"
import { Edge70Parameters, Edge70Signal } from "../../interfaces/edge70-signal"
import { DateTime } from "luxon"
import { Logger } from "../../../../lib/faux_logger"
import { PositionSizer } from "../../../../edges/position-sizer/fixed-position-sizer"

/* convert Edge70Signals to Orders and throw them to PositionsTracker - with mock_redis */

export class BacktestPortfolioTracker implements Edge70SignalCallbacks {
  logger: Logger
  edge: "edge70" | "edge70-backtest"
  health_and_readiness: HealthAndReadiness
  position_sizer :PositionSizer

  constructor({
    logger,
    edge,
    health_and_readiness,
  }: {
    logger: Logger
    edge: "edge70" | "edge70-backtest"
    health_and_readiness: HealthAndReadiness
    edge70_parameters: Edge70Parameters
  }) {
    this.logger = logger
    this.edge = edge
    this.health_and_readiness = health_and_readiness
  }

  async init(): Promise<void> {}

  async publish(args: Edge70Signal): Promise<void> {
    let { direction } = args
    let { base_asset, symbol } = args.market_identifier
    let { edge } = this
    let tags = { edge, base_asset, direction, symbol }

    let date = DateTime.fromMillis(args.signal.signal_timestamp_ms).toFormat('yyyy LLL dd')
    this.logger.info(tags, `${date}: ${base_asset} ${direction.toUpperCase()}`)
  }
}
