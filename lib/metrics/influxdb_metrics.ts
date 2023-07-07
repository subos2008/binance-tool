import { ServiceLogger } from "../../interfaces/logger"
import { MetricValue, SubmitMetrics } from "../../interfaces/metrics"

import { StatsD, Tags } from "hot-shots"
import { InfluxDB, Point, WriteApi } from "@influxdata/influxdb-client"

export class InfluxDBMetrics implements SubmitMetrics {
  logger: ServiceLogger
  prefix: string
  writeApi: WriteApi

  constructor({ logger, prefix }: { logger: ServiceLogger; prefix: string }) {
    this.logger = logger
    this.prefix = prefix

    const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN
    if (!INFLUXDB_TOKEN) {
      throw new Error(`INFLUXDB_TOKEN not defined`)
    }
    const INFLUXDB_HOST = process.env.INFLUXDB_HOST
    if (!INFLUXDB_HOST) {
      throw new Error(`INFLUXDB_HOST not defined`)
    }
    const INFLUXDB_ORG_ID = process.env.INFLUXDB_ORG_ID
    if (!INFLUXDB_ORG_ID) {
      throw new Error(`INFLUXDB_ORG_ID not defined`)
    }
    const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET
    if (!INFLUXDB_BUCKET) {
      throw new Error(`INFLUXDB_BUCKET not defined`)
    }
    this.writeApi = new InfluxDB({ url: INFLUXDB_HOST, token: INFLUXDB_TOKEN }).getWriteApi(
      INFLUXDB_ORG_ID,
      INFLUXDB_BUCKET,
      "s"
    )
  }

  private build_metric_name(metric_name: string): string {
    metric_name.replace(/^\.+/, "") // Remove leading '.'s
    return `${this.prefix}.${metric_name}`
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
    try {
      metric_name = this.build_metric_name(metric_name)
      let point1 = new Point(metric_name)

      for (let key in tags) {
        point1 = point1.tag(key, tags[key])
      }

      /* All values are type float by typescript */
      // could use map for this...
      for (let float_value of values.filter((v) => v.type == "float")) {
        point1.floatField(float_value.name, float_value.value)
      }
      this.writeApi.writePoint(point1)
    } catch (err) {
      this.logger.exception(tags, err, `Error "${err}" uploading ${metric_name} to influxdb.`)
    }
  }

  async increment_by_1({ metric_name, tags }: { metric_name: string; tags: { [tag_name: string]: string } }) {
    metric_name = this.build_metric_name(metric_name)
    let point1 = new Point(metric_name)

    for (let key in tags) {
      point1 = point1.tag(key, tags[key])
    }

    /** Sum all the counts in a timeframe to see the 'count'... */
    point1.intField("count", 1)
    this.writeApi.writePoint(point1)
  }

  async metric({
    metric_name,
    values,
    tags,
  }: {
    metric_name: string
    values: MetricValue[]
    tags: { [tag_name: string]: string }
  }) {
    try {
      metric_name = this.build_metric_name(metric_name)
      let point1 = new Point(metric_name)

      for (let key in tags) {
        point1 = point1.tag(key, tags[key])
      }

      /* All values are type float by typescript */
      // could use map for this...
      for (let float_value of values.filter((v) => v.type == "float")) {
        point1.floatField(float_value.name, float_value.value)
      }
      this.writeApi.writePoint(point1)
    } catch (err) {
      this.logger.exception(tags, err, `Error "${err}" uploading ${metric_name} to influxdb.`)
    }
  }
}
