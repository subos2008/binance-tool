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
  }
}
