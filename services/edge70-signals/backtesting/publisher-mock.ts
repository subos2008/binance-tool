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

    /* telegram */
    try {
      let msg = args.msg
      this.logger.info(tags, msg)
    } catch (e) {
      this.logger.error(tags, `Failed to publish to telegram for ${symbol}`)
      Sentry.captureException(e)
    }

    try {
      let date = new Date(args.signal.signal_timestamp_ms)
      console.log(`${date} SIGNAL ${direction} `)
    } catch (e) {
      this.logger.warn(tags, `Failed to publish to AMQP for ${symbol}`)
      // This can happen if top 100 changes since boot and we refresh the market_data... eh?
      Sentry.captureException(e)
    }
  }
}
