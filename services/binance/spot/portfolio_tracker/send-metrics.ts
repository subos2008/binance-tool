import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Portfolio } from "../../../../interfaces/portfolio"
import { ServiceLogger } from "../../../../interfaces/logger"
import { MetricTags, SubmitMetrics } from "../../../../interfaces/metrics"
import { InfluxDBMetrics } from "../../../../lib/metrics/influxdb_metrics"

export class SendMetrics {
  metrics: SubmitMetrics
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
    this.metrics = new InfluxDBMetrics({ logger, prefix: "trading_engine.portfolio", global_tags: {} })
  }

  async submit_portfolio_as_metrics({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier_V3
    portfolio: Portfolio
  }) {
    try {
      this.logger.debug(`Submitting metrics for ${portfolio.balances.length} balances`)

      // Submit entire portfolio metrics

      if (portfolio.usd_value) {
        let tags: MetricTags = { exchange: exchange_identifier.exchange, exchange_type: exchange_identifier.type }
        await this.metrics.metric({
          metric_name: `.spot.holdings.total`,
          values: [{ name: "usd_equiv", type: "float", value: portfolio.usd_value }],
          tags,
        })
      }

      // Submit individual metrics
      for (const balance of portfolio.balances) {
        let base_asset = balance.asset
        if (balance.quote_equivalents) {
          this.logger.debug(
            `Submitting metrics for ${base_asset}: ${Object.keys(balance.quote_equivalents).join(", ")}`
          )
        } else this.logger.info(`No balance.quote_equivalents for ${base_asset}: `)
        for (const quote_asset in balance.quote_equivalents) {
          let quote_amount = balance.quote_equivalents[quote_asset]
          // let exchange = exchange_identifier.exchange
          // let account = exchange_identifier.account
          let tags: MetricTags = { base_asset, quote_asset /*exchange, account*/ }

          await this.metrics.metric({
            metric_name: `.spot.holdings`,
            values: [{ name: quote_asset, type: "float", value: quote_amount }],
            tags,
          })
        }
      }
    } catch (err) {
      this.logger.exception({}, err)
    }
  }
}
