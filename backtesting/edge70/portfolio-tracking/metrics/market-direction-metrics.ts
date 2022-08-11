#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

// - name: INFLUXDB_HOST
// - name: INFLUXDB_TOKEN
// - name: INFLUXDB_ORG_ID

import influxdb from "../../../../lib/influxdb"
import { ServiceLogger } from "../../../../interfaces/logger"
import Sentry from "../../../../lib/sentry"
import { PortfolioSummary } from "../portfolio-summary"
import { Point } from "@influxdata/influxdb-client"
import { DirectionPersistenceMock } from "../../direction-persistance-mock"

/**
 * Event/message listener
 */

export class HooksMarketDirectionMetrics {
  private logger: ServiceLogger
  private backtest_run_id: string


  constructor({
    logger,
    backtest_run_id,
    quote_asset,
  }: {
    logger: ServiceLogger
    backtest_run_id: string
    quote_asset: string
  }) {
    this.logger = logger
    this.backtest_run_id = backtest_run_id
  }

   async upload_market_direction(args: { long: number; short: number; unknown: number; timestamp: Date }) {
    let points: Point[] = []
    points.push(
      new Point(`market.direction`)
        .timestamp(args.timestamp)
        .tag("backtest_run_id", this.backtest_run_id)
        .floatField("long", args.long)
        .floatField("short", args.short)
        .floatField("unknown", args.unknown)
    )
    await this.upload_points(points)
  }

  private async upload_points(points: Point[]) {
    try {
      await influxdb.writePoints(points)
    } catch (err) {
      this.logger.exception({}, err, `Error "${err}" generating metrics for influxdb.`)
      throw err
    }
  }

  async shutdown() {
    await influxdb.flush_and_close()
  }
}
