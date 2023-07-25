import { Command, LoggableEvent, Result, ServiceLogger } from "../../interfaces/logger"
import { EventMetrics, MetricTags, MetricValue, SubmitMetrics } from "../../interfaces/metrics"
import { InfluxDB, Point, WriteApi } from "@influxdata/influxdb-client"

export class InfluxDBMetrics implements SubmitMetrics, EventMetrics {
  logger: ServiceLogger
  prefix: string | undefined
  global_tags: MetricTags
  writeApi: WriteApi | undefined

  constructor({
    logger,
    prefix,
    global_tags,
  }: {
    logger: ServiceLogger
    prefix?: string
    global_tags: MetricTags
  }) {
    this.logger = logger
    this.prefix = prefix
    this.global_tags = global_tags

    logger.set_event_metrics(this)

    const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN
    if (!INFLUXDB_TOKEN) {
      this.logger.exception({}, new Error(`INFLUXDB_TOKEN not defined`))
    }
    const INFLUXDB_HOST = process.env.INFLUXDB_HOST
    if (!INFLUXDB_HOST) {
      this.logger.exception({}, new Error(`INFLUXDB_HOST not defined`))
    }
    const INFLUXDB_ORG_ID = process.env.INFLUXDB_ORG_ID
    if (!INFLUXDB_ORG_ID) {
      this.logger.exception({}, new Error(`INFLUXDB_ORG_ID not defined`))
    }
    const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || "binance-tool"
    if (!INFLUXDB_BUCKET) {
      this.logger.exception({}, new Error(`INFLUXDB_BUCKET not defined`))
    }
    if (INFLUXDB_HOST && INFLUXDB_TOKEN && INFLUXDB_ORG_ID && INFLUXDB_BUCKET) {
      this.writeApi = new InfluxDB({ url: INFLUXDB_HOST, token: INFLUXDB_TOKEN }).getWriteApi(
        INFLUXDB_ORG_ID,
        INFLUXDB_BUCKET,
        "s"
      )
    }
  }

  private build_metric_name(metric_name: string): string {
    metric_name.replace(/^\.+/, "") // Remove leading '.'s
    if (this.prefix) return `${this.prefix}.${metric_name}`
    return metric_name
  }

  // async gauge({
  //   metric_name,
  //   values,
  //   tags,
  // }: {
  //   metric_name: string
  //   values: MetricValue[]
  //   tags: { [tag_name: string]: string }
  // }) {
  //   try {
  //     metric_name = this.build_metric_name(metric_name)
  //     let point1 = new Point(metric_name)

  //     for (let key in tags) {
  //       point1 = point1.tag(key, tags[key])
  //     }

  //     /* All values are type float by typescript */
  //     // could use map for this...
  //     for (let float_value of values.filter((v) => v.type == "float")) {
  //       point1.floatField(float_value.name, float_value.value)
  //     }
  //     this.writeApi.writePoint(point1)
  //   } catch (err) {
  //     this.logger.exception(tags, err, `Error "${err}" uploading ${metric_name} to influxdb.`)
  //   }
  // }

  async increment_by_1({ metric_name, tags }: { metric_name: string; tags: { [tag_name: string]: string } }) {
    if (!this.writeApi) {
      this.logger.warn(`Failed to submit metric, not configured`)
      return
    }
    metric_name = this.build_metric_name(metric_name)
    let point1 = new Point(metric_name)

    for (let key in this.global_tags) {
      point1 = point1.tag(key, this.global_tags[key])
    }

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
    if (!this.writeApi) {
      this.logger.warn(`Failed to submit metric, not configured`)
      return
    }
    try {
      metric_name = this.build_metric_name(metric_name)
      let point1 = new Point(metric_name)

      for (let key in this.global_tags) {
        point1 = point1.tag(key, this.global_tags[key])
      }

      for (let key in tags) {
        point1 = point1.tag(key, tags[key])
      }

      /* All values are type float by typescript */
      // could use map for this...
      for (let float_value of values.filter((v) => v.type == "float")) {
        point1.floatField(float_value.name, float_value.value)
      }
      for (let float_value of values.filter((v) => v.type == "uint")) {
        point1.uintField(float_value.name, float_value.value)
      }
      this.writeApi.writePoint(point1)
    } catch (err) {
      this.logger.exception(tags, err, `Error "${err}" uploading ${metric_name} to influxdb.`)
    }
  }

  async result({ event }: { event: Result }) {
    if (!this.writeApi) {
      this.logger.warn(`Failed to submit metric, not configured`)
      return
    }
    let metric_name = `logger.loggable_event`
    try {
      metric_name = this.build_metric_name(metric_name)
      let point1 = new Point(metric_name)

      for (let key in this.global_tags) {
        point1 = point1.tag(key, this.global_tags[key])
      }

      point1 = point1.tag("object_type", event.object_type)
      point1 = point1.tag("object_class", event.object_class)
      point1 = point1.stringField("status", event.status)

      this.writeApi.writePoint(point1)
    } catch (err) {
      this.logger.exception({}, err, `Error "${err}" uploading ${metric_name} to influxdb.`)
    }
  }
}
