import { StatsD, Tags } from "hot-shots"

function dogstatsderrorhandler(err: Error) {
  console.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import * as Sentry from "@sentry/node"
Sentry.init({})

import { SpotEdgePerformanceEvent } from "./interfaces"

export class SendDatadogMetrics {
  dogstatsd: StatsD
  constructor() {
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      // globalTags: {
      //   service_name,
      //   exchange_type: exchange_identifier.type,
      //   exchange: exchange_identifier.exchange,
      // },
      prefix: "trading_engine.edge_performance",
    })
  }

  async ingest_event(event: SpotEdgePerformanceEvent) {
    let { edge, exchange, exchange_type, loss, base_asset } = event
    let tags: Tags = {
      edge,
      exchange,
      exchange_type,
      base_asset,
      result: loss ? "loss" : "win",
      direction: "long", // spot
    }
    this.dogstatsd.increment(`.position_closed`, 1, 1, tags, function (err, bytes) {
      if (err) {
        console.error(
          "Oh noes! There was an error submitting .position_closed metrics to DogStatsD for ${edge}:${base_asset}:",
          err
        )
        console.error(err)
        Sentry.captureException(err)
      } else {
        console.log("Successfully sent", bytes, "bytes .position_closed to DogStatsD for ${edge}:${base_asset}")
      }
    })
    this.dogstatsd.distribution(`.days_in_position`, event.days_in_position, tags, function (err, bytes) {
      if (err) {
        console.error(
          "Oh noes! There was an error submitting .days_in_position metrics to DogStatsD for ${edge}:${base_asset}:",
          err
        )
        console.error(err)
        Sentry.captureException(err)
      } else {
        console.log("Successfully sent", bytes, "bytes .days_in_position to DogStatsD for ${edge}:${base_asset}")
      }
    })
    this.dogstatsd.distribution(`.abs_quote_change`, Number(event.abs_quote_change), tags, function (err, bytes) {
      if (err) {
        console.error(
          "Oh noes! There was an error submitting .abs_quote_change metrics to DogStatsD for ${edge}:${base_asset}:",
          err
        )
        console.error(err)
        Sentry.captureException(err)
      } else {
        console.log("Successfully sent", bytes, "bytes .abs_quote_change to DogStatsD for ${edge}:${base_asset}")
      }
    })
    if (event.percentage_quote_change)
      this.dogstatsd.distribution(`.abs_quote_change`, event.percentage_quote_change, tags, function (err, bytes) {
        if (err) {
          console.error(
            "Oh noes! There was an error submitting .percentage_quote_change metrics to DogStatsD for ${edge}:${base_asset}:",
            err
          )
          console.error(err)
          Sentry.captureException(err)
        } else {
          console.log(
            "Successfully sent",
            bytes,
            "bytes .percentage_quote_change to DogStatsD for ${edge}:${base_asset}"
          )
        }
      })
  }
}
