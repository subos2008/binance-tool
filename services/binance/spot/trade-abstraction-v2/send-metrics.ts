import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { ServiceLogger } from "../../../../interfaces/logger"
import { TradeAbstractionOpenLongResult } from "./interfaces/long"
import { TradeAbstractionCloseResult } from "./interfaces/close"
import { MetricTags, MetricValue, SubmitMetrics } from "../../../../interfaces/metrics"
import { InfluxDBMetrics } from "../../../../lib/metrics/influxdb_metrics"

export class SendMetrics {
  metrics: SubmitMetrics
  logger: ServiceLogger
  globa_tags: MetricTags

  constructor({
    service_name,
    exchange_identifier,
    logger,
  }: {
    service_name: string
    exchange_identifier: ExchangeIdentifier_V4
    logger: ServiceLogger
  }) {
    this.logger = logger
    this.globa_tags = {
      service_name,
      exchange_type: exchange_identifier.exchange_type,
      exchange: exchange_identifier.exchange,
    }
    this.metrics = new InfluxDBMetrics({
      logger,
      prefix: "trading_engine.tas",
      global_tags: this.globa_tags,
    })
  }

  service_started() {
    this.metrics
      .increment_by_1({ metric_name: `service_started`, tags: {} })
      .catch((err) => this.logger.exception(this.globa_tags, err, `Failed to submit metrics to DogStatsD`))
  }

  signal_to_cmd_received_slippage_ms({
    cmd_received_timestamp_ms,
    signal_timestamp_ms,
    tags,
  }: {
    cmd_received_timestamp_ms: number
    signal_timestamp_ms: number
    tags: { [key: string]: string }
  }) {
    try {
      let signal_to_cmd_received_slippage_ms = new BigNumber(cmd_received_timestamp_ms)
        .minus(signal_timestamp_ms)
        .toFixed()

      this.metrics
        .metric({
          metric_name: "cmd_received",
          values: [
            {
              name: "signal_to_cmd_received_slippage_ms",
              value: signal_to_cmd_received_slippage_ms,
              type: "uint",
            },
          ],
          tags,
        })
        .catch((err) => this.logger.exception(tags, err, `Failed to submit metric to DogStatsD`))
    } catch (err) {
      this.logger.exception(tags, err, `Failed to submit metric to DogStatsD`)
    }
  }

  trading_abstraction_open_spot_long_result({
    result,
    cmd_received_timestamp_ms,
    tags,
  }: {
    result: TradeAbstractionOpenLongResult
    cmd_received_timestamp_ms: number
    tags: {
      [key: string]: string
    }
  }) {
    try {
      let values: MetricValue[] = [{ name: "count", value: "1", type: "uint" }]

      // TODO: add command_recieved_to_execution_slippage
      if (result.signal_to_execution_slippage_ms)
        values.push({
          name: "signal_to_execution_slippage_ms",
          value: result.signal_to_execution_slippage_ms,
          type: "uint",
        })

      // Probably being a bit anal with my avoidance of floating point here...
      let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
        .minus(cmd_received_timestamp_ms)
        .toFixed(0)
      values.push({
        name: "execution_time_ms",
        value: execution_time_ms,
        type: "uint",
      })

      this.metrics
        .metric({ metric_name: "open_spot_long_result", tags, values })
        .catch((err) => this.logger.exception(tags, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception(tags, err, `Failed to calculate metrics`)
    }
  }

  trading_abstraction_close_result({
    result,
    cmd_received_timestamp_ms,
    tags,
  }: {
    result: TradeAbstractionCloseResult
    cmd_received_timestamp_ms: number
    tags: {
      [key: string]: string
    }
  }) {
    try {
      let values: MetricValue[] = [{ name: "count", value: "1", type: "uint" }]

      // TODO: add command_recieved_to_execution_slippage
      if (result.signal_to_execution_slippage_ms)
        values.push({
          name: "signal_to_execution_slippage_ms",
          value: result.signal_to_execution_slippage_ms.toFixed(),
          type: "uint",
        })

      // Probably being a bit anal with my avoidance of floating point here...
      let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
        .minus(cmd_received_timestamp_ms)
        .toFixed(0)
      values.push({
        name: "execution_time_ms",
        value: execution_time_ms,
        type: "uint",
      })

      this.metrics
        .metric({ metric_name: "spot_close_result", tags, values })
        .catch((err) => this.logger.exception(tags, err, `Failed to submit metrics`))
    } catch (err) {
      this.logger.exception(tags, err, `Failed to submit metrics to DogStatsD`)
    }
  }
}
