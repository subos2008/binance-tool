import { StatsD, Tags } from "hot-shots"

function dogstatsderrorhandler(err: Error) {
  console.error({ err }, `DogStatsD: Socket errors caught here: ${err}`)
}

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import Sentry from "../../../../lib/sentry"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Logger } from "../../../../interfaces/logger"
// import { TradeAbstractionOpenSpotLongResult } from "./interfaces/long"
import { TradeAbstractionCloseResult } from "./interfaces/close"
import { TradeAbstractionOpenShortResult } from "./interfaces/short"

export class SendDatadogMetrics {
  dogstatsd: StatsD
  logger: Logger

  constructor({
    service_name,
    exchange_identifier,
    logger,
  }: {
    service_name: string
    exchange_identifier: ExchangeIdentifier_V3
    logger: Logger
  }) {
    this.logger = logger
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      globalTags: {
        service_name,
        exchange_type: exchange_identifier.type,
        exchange: exchange_identifier.exchange,
      },
      prefix: "trading_engine.tas",
    })
  }

  service_started() {
    try {
      this.dogstatsd.increment(`.service_started`, 1, 1, function (error, bytes) {
        //this only gets called once after all messages have been sent
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          // console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (e) {
      this.logger.warn(`Failed to submit metrics to DogStatsD`)
      Sentry.captureException(e)
    }
  }

  signal_to_cmd_received_slippage_ms({
    cmd_received_timestamp_ms,
    signal_timestamp_ms,
    tags,
  }: {
    cmd_received_timestamp_ms: number
    signal_timestamp_ms: number
    tags: Tags
  }) {
    try {
      let signal_to_cmd_received_slippage_ms = Number(
        new BigNumber(cmd_received_timestamp_ms).minus(signal_timestamp_ms).toFixed()
      )
      this.dogstatsd.distribution(
        ".signal_to_cmd_received_slippage_ms",
        signal_to_cmd_received_slippage_ms,
        undefined,
        tags
      )
    } catch (err) {
      this.logger.warn({ ...tags, err }, `Failed to submit metric to DogStatsD`)
      Sentry.captureException(err)
    }
  }

  trading_abstraction_open_short_result({
    result,
    cmd_received_timestamp_ms,
    tags,
  }: {
    result: TradeAbstractionOpenShortResult
    cmd_received_timestamp_ms: number
    tags: Tags
  }) {
    try {
      // TODO: add command_recieved_to_execution_slippage
      this.dogstatsd.increment(".trading_abstraction_open_short_result", tags)
      if (result.signal_to_execution_slippage_ms)
        this.dogstatsd.distribution(
          ".signal_to_execution_slippage_ms",
          Number(result.signal_to_execution_slippage_ms),
          undefined,
          tags
        )
      // Probably being a bit anal with my avoidance of floating point here...
      let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
        .minus(cmd_received_timestamp_ms)
        .toFixed(0)
      this.dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
    } catch (err) {
      this.logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
      Sentry.captureException(err)
    }
  }

  trading_abstraction_close_result({
    result,
    cmd_received_timestamp_ms,
    tags,
  }: {
    result: TradeAbstractionCloseResult
    cmd_received_timestamp_ms: number
    tags: Tags
  }) {
    try {
      this.dogstatsd.increment(".trading_abstraction_close_result", tags)
      if (result.signal_to_execution_slippage_ms)
        this.dogstatsd.distribution(
          ".signal_to_execution_slippage_ms",
          Number(result.signal_to_execution_slippage_ms),
          undefined,
          tags
        )
      // Probably being a bit anal with my avoidance of floating point here...
      let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
        .minus(cmd_received_timestamp_ms)
        .toFixed(0)
      this.dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
    } catch (err) {
      this.logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
      Sentry.captureException(err)
    }
  }
}
