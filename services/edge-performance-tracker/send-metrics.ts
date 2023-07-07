import { ServiceLogger } from "../../interfaces/logger"
import { MetricTags, MetricValue, SubmitMetrics } from "../../interfaces/metrics"
import { InfluxDBMetrics } from "../../lib/metrics/influxdb_metrics"
import { SpotEdgePerformanceEvent } from "./interfaces"

export class SendMetrics {
  metrics: SubmitMetrics
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
    this.metrics = new InfluxDBMetrics({ logger, prefix: "trading_engine.edge_performance" })
  }

  async ingest_event(event: SpotEdgePerformanceEvent) {
    let { edge, exchange, exchange_type, loss, base_asset } = event
    let tags: MetricTags = {
      edge,
      exchange,
      exchange_type,
      base_asset,
      result: loss ? "loss" : "win",
      direction: "long", // spot
    }

    let values: MetricValue[] = [
      { name: "days_in_position", value: event.days_in_position.toFixed(), type: "float" },
    ]

    if (event.percentage_quote_change)
      values.push({
        name: "percentage_quote_change",
        value: event.percentage_quote_change.toFixed(),
        type: "float",
      })

    if (event.abs_quote_change)
      values.push({ name: "abs_quote_change", value: event.abs_quote_change, type: "float" })

    this.metrics
      .metric({
        metric_name: `position_closed`,
        tags,
        values,
      })
      .catch((err) => this.logger.exception({}, err))
  }
}
