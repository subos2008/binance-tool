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
      prefix: "trading_engine",
    })
  }

  async ingest_event(event: SpotEdgePerformanceEvent) {
    try {
      let { edge, exchange, exchange_type, loss, base_asset } = event
      let tags: Tags = { edge, exchange, exchange_type, base_asset, result: loss ? "loss" : "win" }
      this.dogstatsd.increment(`.position_closed`, 1, 1, tags, function (error, bytes) {
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (err) {
      console.warn(`Failed to submit metrics to DogStatsD`)
      console.error(err)
      Sentry.captureException(err)
      throw err
    }
  }
}
