import { StatsD, Tags } from "hot-shots"

function dogstatsderrorhandler(err: Error) {
  console.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import * as Sentry from "@sentry/node"
Sentry.init({})

export class SendDatadogMetrics {
  dogstatsd: StatsD
  constructor(service_name: string) {
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      globalTags: {
        service_name,
        //   exchange_type: exchange_identifier.type,
        //   exchange: exchange_identifier.exchange,
      },
      prefix: "trading_engine.edge_performance",
    })
  }


}
