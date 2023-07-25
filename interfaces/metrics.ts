/**
 * Modelled on the DogStatsD and InfluxDB mixed styles of metrics
 *
 * Datadog has one value per metric.
 * InfluxDB can have multiple. So the values become individual metrics in Datadog.
 *
 * This is why we have MetricValue and values - InfluxDB can have multiple values (with names) per metric
 */

import { Command, Lifecycle, LoggableEvent, Result } from "./logger"

export type MetricValue = {
  name: string
  type: "float" | "uint" // implement other types in influx handler when expanding this list
  value: string
}

export type MetricTags = {
  [tag_name: string]: string
}

export type SubmitMetrics = {
  // gauge(args: { metric_name: string; values: MetricValue[]; tags: { [tag_name: string]: string } }): Promise<void>

  /* More closely matches InfluxDB's way of doing things */
  metric(args: { metric_name: string; values: MetricValue[]; tags: { [tag_name: string]: string } }): Promise<void>

  increment_by_1({
    metric_name,
    tags,
  }: {
    metric_name: string
    tags: { [tag_name: string]: string }
  }): Promise<void>
}

export type EventMetrics = {
  result({ event }: { event: Result; lifecycle: Lifecycle }): Promise<void>
}
