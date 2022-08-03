import Sentry from "../../../lib/sentry"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { Edge70Parameters, Edge70Signal } from "../interfaces/edge70-signal"
import { Logger } from "../../../lib/faux_logger"
import { HealthAndReadiness } from "../../../classes/health_and_readiness"
import { Edge70SignalCallbacks } from "../interfaces/_internal"
import { DateTime } from "luxon";

export class Edge70AMQPSignalPublisherMock implements Edge70SignalCallbacks {
  logger: Logger
  edge: "edge70" | "edge70-backtest"
  health_and_readiness: HealthAndReadiness

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
