#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

// - name: INFLUXDB_HOST
// - name: INFLUXDB_TOKEN
// - name: INFLUXDB_ORG_ID

import influxdb from "../../../../../lib/influxdb"
import { ServiceLogger } from "../../../../../interfaces/logger"
import Sentry from "../../../../../lib/sentry"
import { PortfolioSummary } from "../portfolio-summary"
import { Point } from "@influxdata/influxdb-client"

/**
 * Event/message listener
 */

export class HooksPortfolioSummaryMetrics {
  private logger: ServiceLogger
  private backtest_run_id: string
  private quote_asset: string

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
    this.quote_asset = quote_asset
  }

  private async upload_positions(portfolio_summary: PortfolioSummary) {
    let { quote_asset } = this
    let points: Point[] = []
    for (const p of await portfolio_summary.positions_snapshot.get_positions_quote_values({ quote_asset })) {
      points.push(
        new Point(`position`)
          .timestamp(portfolio_summary.timestamp)
          .tag("backtest_run_id", this.backtest_run_id)
          .tag("base_asset", p.base_asset)
          .floatField("quote_value", p.quote_value.toNumber())
          .floatField(quote_asset, p.quote_value.toNumber())
      )
    }
    await this.upload_points(points)
  }

  private async upload_portfolio_percentages(portfolio_summary: PortfolioSummary): Promise<void> {
    let points: Point[] = []
    let portfolio_percentages = await portfolio_summary.portfolio_percentages()
    points.push(
      new Point(`portfolio_percentages`)
        .timestamp(portfolio_summary.timestamp)
        .tag("backtest_run_id", this.backtest_run_id)
        .floatField("investments", portfolio_percentages.investments.toNumber())
        .floatField("cash", portfolio_percentages.cash.toNumber())
    )
    await this.upload_points(points)
  }

  private async upload_portfolio_abs(portfolio_summary: PortfolioSummary): Promise<void> {
    let { quote_asset } = this
    let points: Point[] = []
    points.push(
      new Point(`portfolio`)
        .timestamp(portfolio_summary.timestamp)
        .tag("backtest_run_id", this.backtest_run_id)
        .floatField("open_positions_count", await portfolio_summary.open_positions_count())
        .floatField("cash", portfolio_summary.cash.toNumber())
        .floatField("loan", portfolio_summary.loan.toNumber())
        .floatField(
          "investments",
          (await portfolio_summary.positions_snapshot.get_total_value_in_quote_asset({ quote_asset })).toNumber()
        )
        .floatField("total", await portfolio_summary.total_assets_inc_cash())
        .floatField("net", await portfolio_summary.net_worth())
    )
    await this.upload_points(points)
  }

  async upload_metrics(portfolio_summary: PortfolioSummary): Promise<void> {
    await this.upload_portfolio_abs(portfolio_summary)
    await this.upload_portfolio_percentages(portfolio_summary)
    await this.upload_positions(portfolio_summary)
  }

  private async upload_points(points: Point[]) {
    try {
      await influxdb.writePoints(points)
    } catch (err) {
      this.logger.exception({}, err, `Error "${err}" generating metrics for influxdb.`)
      throw err
    }
  }

  async shutdown( ) {
    await influxdb.flush_and_close()
  }
}
