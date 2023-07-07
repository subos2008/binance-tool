import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ExchangeIdentifier_V4 } from "../../../../../events/shared/exchange-identifier"
import { ServiceLogger } from "../../../../../interfaces/logger"
import {
  TradeAbstractionOpenLongCommand_OCO_Exit,
  TradeAbstractionOpenLongCommand_StopLimitExit,
} from "../interfaces/long"
import {
  SpotExecutionEngineBuyResult,
  SpotStopMarketSellCommand,
  SpotStopMarketSellResult,
} from "../../../../../interfaces/exchanges/spot-execution-engine"
import { MetricTags, SubmitMetrics } from "../../../../../interfaces/metrics"
import { InfluxDBMetrics } from "../../../../../lib/metrics/influxdb_metrics"

export class SendMetrics {
  logger: ServiceLogger
  metrics: SubmitMetrics

  constructor({
    exchange_identifier,
    logger,
  }: {
    exchange_identifier: ExchangeIdentifier_V4
    logger: ServiceLogger
  }) {
    this.logger = logger
    this.metrics = new InfluxDBMetrics({
      logger,
      prefix: "trading_engine.tas.spot.binance.ee",
      global_tags: {
        exchange_type: exchange_identifier.exchange_type,
        exchange: exchange_identifier.exchange,
      },
    })
  }

  buy_limit_request(
    args: TradeAbstractionOpenLongCommand_OCO_Exit | TradeAbstractionOpenLongCommand_StopLimitExit
  ) {
    try {
      let { base_asset, quote_asset, edge, direction, action } = args
      let tags: MetricTags = { base_asset, quote_asset, edge, direction, action }
      this.metrics
        .increment_by_1({ metric_name: `buy_limit.command`, tags })
        .catch((err) => this.logger.exception({}, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics`)
    }
  }

  buy_limit_result(
    args: SpotExecutionEngineBuyResult,
    { base_asset, quote_asset, edge }: { base_asset: string; quote_asset: string; edge: string }
  ) {
    try {
      let { status } = args
      let tags: MetricTags = { status, base_asset, quote_asset, edge }

      this.metrics
        .increment_by_1({ metric_name: `buy_limit.result`, tags })
        .catch((err) => this.logger.exception({}, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  stop_market_sell_request(args: SpotStopMarketSellCommand) {
    try {
      let { base_asset, quote_asset, edge } = args.trade_context
      let tags: MetricTags = { base_asset, edge }
      if (quote_asset) tags["quote_asset"] = quote_asset

      this.metrics
        .increment_by_1({ metric_name: `stop_market_sell.command`, tags })
        .catch((err) => this.logger.exception({}, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  stop_market_sell_result(args: SpotStopMarketSellResult) {
    try {
      let { base_asset, quote_asset, edge } = args.trade_context
      let tags: MetricTags = { base_asset, edge }
      if (quote_asset) tags["quote_asset"] = quote_asset

      this.metrics
        .increment_by_1({ metric_name: `stop_market_sell.result`, tags })
        .catch((err) => this.logger.exception({}, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }
}
