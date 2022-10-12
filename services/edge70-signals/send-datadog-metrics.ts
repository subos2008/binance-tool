import { StatsD, Tags } from "hot-shots"
import { ServiceLogger } from "../../interfaces/logger"

function dogstatsderrorhandler(err: Error) {
  console.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import { MarketDirection } from "./interfaces/metrics"

export class SendDatadogMetrics {
  logger: ServiceLogger
  dogstatsd: StatsD

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      // globalTags: {
      //   service_name,
      //   exchange_type: exchange_identifier.type,
      //   exchange: exchange_identifier.exchange,
      // },
      prefix: "trading_engine.edge_signals",
    })
  }

  async ingest_market_direction(event: MarketDirection) {
    let {
      edge,
      exchange,
      exchange_type,
      base_asset,
      quote_asset,
      direction,
      previous_direction,
      changed_direction,
      changed_to_long,
      changed_to_short,
    } = event

    let tags: Tags = {
      edge,
      exchange,
      exchange_type,
      base_asset,
      quote_asset,
      direction,
      previous_direction,
      changed_direction,
      changed_to_long,
      changed_to_short,
    }

    this.dogstatsd.increment(`.market_direction`, 1, 1, tags, (err, bytes) => {
      if (err) {
        this.logger.error(
          tags,
          `Oh noes! There was an error submitting .market_direction metrics to DogStatsD for ${edge}:${base_asset}:`,
          err
        )
        this.logger.exception({ edge, base_asset, exchange }, err)
      } else {
        // console.log("Successfully sent", bytes, "bytes .position_closed to DogStatsD for ${edge}:${base_asset}")
      }
    })
  }
}
