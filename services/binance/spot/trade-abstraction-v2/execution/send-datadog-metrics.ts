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

import { ExchangeIdentifier_V3 } from "../../../../../events/shared/exchange-identifier"
import { ServiceLogger } from "../../../../../interfaces/logger"
import {
  TradeAbstractionOpenLongCommand_OCO_Exit,
  TradeAbstractionOpenLongCommand_StopLimitExit,
} from "../interfaces/long"
import Sentry from "../../../../../lib/sentry"
import {
  SpotExecutionEngineBuyResult,
  SpotStopMarketSellCommand,
  SpotStopMarketSellResult,
} from "../../../../../interfaces/exchanges/spot-execution-engine"

export class SendDatadogMetrics {
  dogstatsd: StatsD
  logger: ServiceLogger

  constructor({
    exchange_identifier,
    logger,
  }: {
    exchange_identifier: ExchangeIdentifier_V3
    logger: ServiceLogger
  }) {
    this.logger = logger
    this.dogstatsd = new StatsD({
      errorHandler: dogstatsderrorhandler,
      globalTags: {
        exchange_type: exchange_identifier.type,
        exchange: exchange_identifier.exchange,
      },
      prefix: "trading_engine.tas.spot.binance.ee",
    })
  }

  //trading_engine.tas.spot.binance.ee.buy_limit.request

  buy_limit_request(
    args: TradeAbstractionOpenLongCommand_OCO_Exit | TradeAbstractionOpenLongCommand_StopLimitExit
  ) {
    try {
      let { base_asset, quote_asset, edge, direction, action } = args
      let tags: Tags = { base_asset, quote_asset, edge, direction, action }
      this.dogstatsd.increment(`.buy_limit.request`, 1, 1, tags, function (error, bytes) {
        //this only gets called once after all messages have been sent
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          // console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  buy_limit_result(
    args: SpotExecutionEngineBuyResult,
    { base_asset, quote_asset, edge }: { base_asset: string; quote_asset: string; edge: string }
  ) {
    try {
      let { status } = args
      let tags: Tags = { status, base_asset, quote_asset, edge }

      this.dogstatsd.increment(`.buy_limit.result`, 1, 1, tags, function (error, bytes) {
        //this only gets called once after all messages have been sent
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          // console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  stop_market_sell_request(args: SpotStopMarketSellCommand) {
    try {
      let { base_asset, quote_asset, edge } = args.trade_context
      let tags: Tags = { base_asset, edge }
      if (quote_asset) tags["quote_asset"] = quote_asset

      this.dogstatsd.increment(`.stop_market_sell.request`, 1, 1, tags, function (error, bytes) {
        //this only gets called once after all messages have been sent
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          // console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  stop_market_sell_result(args: SpotStopMarketSellResult) {
    try {
      let { base_asset, quote_asset, edge } = args.trade_context
      let tags: Tags = { base_asset, edge }
      if (quote_asset) tags["quote_asset"] = quote_asset

      this.dogstatsd.increment(`.stop_market_sell.result`, 1, 1, tags, function (error, bytes) {
        //this only gets called once after all messages have been sent
        if (error) {
          console.error("Oh noes! There was an error submitting metrics to DogStatsD:", error)
        } else {
          // console.log("Successfully sent", bytes, "bytes to DogStatsD")
        }
      })
    } catch (err) {
      this.logger.exception({}, err, `Failed to submit metrics to DogStatsD`)
    }
  }

  // signal_to_cmd_received_slippage_ms({
  //   cmd_received_timestamp_ms,
  //   signal_timestamp_ms,
  //   tags,
  // }: {
  //   cmd_received_timestamp_ms: number
  //   signal_timestamp_ms: number
  //   tags: Tags
  // }) {
  //   try {
  //     let signal_to_cmd_received_slippage_ms = Number(
  //       new BigNumber(cmd_received_timestamp_ms).minus(signal_timestamp_ms).toFixed()
  //     )
  //     this.dogstatsd.distribution(
  //       ".signal_to_cmd_received_slippage_ms",
  //       signal_to_cmd_received_slippage_ms,
  //       undefined,
  //       tags
  //     )
  //   } catch (err) {
  //     this.logger.warn({ ...tags, err }, `Failed to submit metric to DogStatsD`)
  //     Sentry.captureException(err)
  //   }
  // }

  // trading_abstraction_open_spot_long_result({
  //   result,
  //   cmd_received_timestamp_ms,
  //   tags,
  // }: {
  //   result: TradeAbstractionOpenLongResult
  //   cmd_received_timestamp_ms: number
  //   tags: Tags
  // }) {
  //   try {
  //     // TODO: add command_recieved_to_execution_slippage
  //     this.dogstatsd.increment(".trading_abstraction_open_spot_long_result", tags)
  //     if (result.signal_to_execution_slippage_ms)
  //       this.dogstatsd.distribution(
  //         ".signal_to_execution_slippage_ms",
  //         Number(result.signal_to_execution_slippage_ms),
  //         undefined,
  //         tags
  //       )
  //     // Probably being a bit anal with my avoidance of floating point here...
  //     let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
  //       .minus(cmd_received_timestamp_ms)
  //       .toFixed(0)
  //     this.dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
  //   } catch (err) {
  //     this.logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
  //     Sentry.captureException(err)
  //   }
  // }

  // trading_abstraction_close_result({
  //   result,
  //   cmd_received_timestamp_ms,
  //   tags,
  // }: {
  //   result: TradeAbstractionCloseResult
  //   cmd_received_timestamp_ms: number
  //   tags: Tags
  // }) {
  //   try {
  //     this.dogstatsd.increment(".trading_abstraction_close_result", tags)
  //     if (result.signal_to_execution_slippage_ms)
  //       this.dogstatsd.distribution(
  //         ".signal_to_execution_slippage_ms",
  //         Number(result.signal_to_execution_slippage_ms),
  //         undefined,
  //         tags
  //       )
  //     // Probably being a bit anal with my avoidance of floating point here...
  //     let execution_time_ms = new BigNumber(result.execution_timestamp_ms || +Date.now())
  //       .minus(cmd_received_timestamp_ms)
  //       .toFixed(0)
  //     this.dogstatsd.distribution(".execution_time_ms", Number(execution_time_ms), undefined, tags)
  //   } catch (err) {
  //     this.logger.warn({ ...tags, err }, `Failed to submit metrics to DogStatsD`)
  //     Sentry.captureException(err)
  //   }
  // }
}
