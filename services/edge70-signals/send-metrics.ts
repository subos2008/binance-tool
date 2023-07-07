import { MetricTags, SubmitMetrics } from "../../interfaces/metrics"
import { InfluxDBMetrics } from "../../lib/metrics/influxdb_metrics"
import { ServiceLogger } from "../../interfaces/logger"
import { MarketDirection } from "./interfaces/metrics"

export class SendMetrics {
  logger: ServiceLogger
  metrics: SubmitMetrics

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
    this.metrics = new InfluxDBMetrics({ logger, prefix: "edges.signals", global_tags: {} })
  }

  async ingest_market_direction(event: MarketDirection): Promise<void> {
    let {
      edge,
      exchange,
      exchange_type,
      base_asset,
      quote_asset,
      direction,
      previous_direction,
      changed_direction,
      changed_to_long,
      changed_to_short,
    } = event

    let tags: MetricTags = {
      edge,
      exchange,
      exchange_type,
      base_asset,
      quote_asset,
      direction,
      previous_direction,
      changed_direction,
      changed_to_long,
      changed_to_short,
    }

    await this.metrics.increment_by_1({ metric_name: `market_direction`, tags })
  }
}
