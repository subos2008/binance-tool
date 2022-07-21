import { StatsD, Tags } from "hot-shots"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Portfolio } from "../../../../interfaces/portfolio"
import { Logger } from "../../../../lib/faux_logger"

function dogstatsderrorhandler(err: Error) {
  console.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import Sentry from "../../../../lib/sentry"

export class SendDatadogMetrics {
  dogstatsd: StatsD
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      // globalTags: {
      //   service_name,
      //   exchange_type: exchange_identifier.type,
      //   exchange: exchange_identifier.exchange,
      // },
      prefix: "trading_engine.portfolio",
    })
  }

  async submit_portfolio_as_metrics({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier_V3
    portfolio: Portfolio
  }) {
    try {
      this.logger.info(`Submitting metrics for ${portfolio.balances.length} balances`)

      // Submit entire portfolio metrics

      if (portfolio.usd_value) {
        let tags: Tags = { exchange: exchange_identifier.exchange, exchange_type: exchange_identifier.type }
        this.dogstatsd.gauge(
          `.spot.holdings.total.usd_equiv`,
          Number(portfolio.usd_value),
          undefined,
          tags,
          function (err, bytes) {
            if (err) {
              console.error(
                "Oh noes! There was an error submitting .portfolio.spot.holdings.${quote_asset} metrics to DogStatsD for ${edge}:${base_asset}:",
                err
              )
              console.error(err)
              Sentry.captureException(err)
            } else {
              // console.log(
              //   "Successfully sent",
              //   bytes,
              //   "bytes .portfolio.spot.holdings.${quote_asset} to DogStatsD for ${edge}:${base_asset}"
              // )
            }
          }
        )
      }

      if (portfolio.btc_value) {
        let tags: Tags = { exchange: exchange_identifier.exchange, exchange_type: exchange_identifier.type }
        this.dogstatsd.gauge(
          `.spot.holdings.total.btc_equiv`,
          Number(portfolio.btc_value),
          undefined,
          tags,
          function (err, bytes) {
            if (err) {
              console.error(
                "Oh noes! There was an error submitting .portfolio.spot.holdings.${quote_asset} metrics to DogStatsD for ${edge}:${base_asset}:",
                err
              )
              console.error(err)
              Sentry.captureException(err)
            } else {
              // console.log(
              //   "Successfully sent",
              //   bytes,
              //   "bytes .portfolio.spot.holdings.${quote_asset} to DogStatsD for ${edge}:${base_asset}"
              // )
            }
          }
        )
      }

      // Submit individual metrics
      for (const balance of portfolio.balances) {
        let base_asset = balance.asset
        if (balance.quote_equivalents) {
          this.logger.info(
            `Submitting metrics for ${base_asset}: ${Object.keys(balance.quote_equivalents).join(", ")}`
          )
        } else this.logger.info(`No balance.quote_equivalents for ${base_asset}: `)
        for (const quote_asset in balance.quote_equivalents) {
          let quote_amount = balance.quote_equivalents[quote_asset]
          // let exchange = exchange_identifier.exchange
          // let account = exchange_identifier.account
          let tags: Tags = { base_asset, quote_asset /*exchange, account*/ }

          this.dogstatsd.gauge(
            `.spot.holdings.${quote_asset}`,
            Number(quote_amount),
            undefined,
            tags,
            function (err, bytes) {
              if (err) {
                console.error(
                  "Oh noes! There was an error submitting .portfolio.spot.holdings.${quote_asset} metrics to DogStatsD for ${edge}:${base_asset}:",
                  err
                )
                console.error(err)
                Sentry.captureException(err)
              } else {
                // console.log(
                //   "Successfully sent",
                //   bytes,
                //   "bytes .portfolio.spot.holdings.${quote_asset} to DogStatsD for ${edge}:${base_asset}"
                // )
              }
            }
          )
          this.dogstatsd.gauge(`.spot.holdings`, Number(quote_amount), undefined, tags, function (err, bytes) {
            if (err) {
              console.error(
                "Oh noes! There was an error submitting .portfolio.spot.holdings metrics to DogStatsD for ${edge}:${base_asset}:",
                err
              )
              console.error(err)
              Sentry.captureException(err)
            } else {
              // console.log(
              //   "Successfully sent",
              //   bytes,
              //   "bytes .portfolio.spot.holdings to DogStatsD for ${edge}:${base_asset}"
              // )
            }
          }) // Guess, this is easier to work with
          // this.logger.info(tags, `Submited metric portfolio in ${quote_asset} for ${base_asset}`)
        }
      }
    } catch (err) {
      Sentry.captureException(err)
      console.error(err)
    }
  }
}
