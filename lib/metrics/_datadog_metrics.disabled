import { ServiceLogger } from "../../interfaces/logger"
import { MetricValue, SubmitMetrics } from "../../interfaces/metrics"

import { StatsD, Tags } from "hot-shots"

export class DatadogMetrics implements SubmitMetrics {
  logger: ServiceLogger
  dogstatsd: StatsD
  prefix: string

  constructor({ logger, prefix }: { logger: ServiceLogger; prefix: string }) {
    this.logger = logger
    this.prefix = prefix

    let errorHandler = function errorHandler(err: Error) {
      logger.exception({}, err, `DogStatsD: exception (perhaps a socket error?)`)
    }

    this.dogstatsd = new StatsD({ errorHandler, prefix })
  }

  async gauge({
    metric_name,
    values,
    tags,
  }: {
    metric_name: string
    values: MetricValue[]
    tags: { [tag_name: string]: string }
  }) {
    let logger = this.logger
    for (let value of values) {
      this.dogstatsd.gauge(
        `${metric_name}.${value.name}`,
        Number(value.value),
        undefined,
        tags,
        function (err, bytes) {
          if (err) {
            logger.exception(tags, err, `Error submitting ${metric_name} metrics to DogStatsD:`)
          } else {
            logger.debug(tags, `${metric_name} metrics submitted.`)
          }
        }
      )
    }
  }

  async increment_by_1({ metric_name, tags }: { metric_name: string; tags: { [tag_name: string]: string } }) {
    let logger = this.logger
    this.dogstatsd.increment(metric_name, 1, 1, tags, (err, bytes) => {
      if (err) {
        logger.exception(tags, err, `Error submitting ${metric_name} metrics to DogStatsD`)
      }
    })
  }
}
