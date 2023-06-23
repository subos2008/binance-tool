import { strict as assert } from "assert"

import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { ServiceLogger } from "../../../../interfaces/logger"
import { ExecutionReportCallbacks, OrderCallbacks } from "../../../../interfaces/exchanges/binance/order_callbacks"

import Sentry from "../../../../lib/sentry"
import {
  BalanceUpdate,
  Binance,
  ExecutionReport,
  MarginCall,
  OutboundAccountInfo,
  OutboundAccountPosition,
  UserDataStreamEvent,
} from "binance-api-node"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"

export class BinanceUserWSStream {
  send_message: Function
  logger: ServiceLogger
  ee: Binance
  closeUserWebsocket: Function | undefined
  callbacks: ExecutionReportCallbacks
  print_all_trades: boolean = false
  exchange_identifier: ExchangeIdentifier_V4

  // All numbers are expected to be passed in as strings
  constructor({
    ee, // binance-api-node API
    send_message,
    logger,
    callbacks,
    print_all_trades,
    exchange_identifier,
  }: {
    ee: Binance
    send_message: (msg: string) => void
    logger: ServiceLogger
    callbacks: ExecutionReportCallbacks
    print_all_trades?: boolean
    exchange_identifier: ExchangeIdentifier_V4
  }) {
    assert(logger)
    this.logger = logger
    assert(send_message)
    this.send_message = send_message
    this.callbacks = callbacks
    assert(ee)
    this.ee = ee
    if (print_all_trades) this.print_all_trades = true
    this.exchange_identifier = exchange_identifier

    process.on("exit", () => {
      this.shutdown_streams()
    })
  }

  async main() {
    try {
      await this.monitor_user_stream()
    } catch (err: any) {
      if (err.name && err.name === "FetchError") {
        this.logger.error(`${err.name}: Likely unable to connect to Binance and/or Telegram: ${err}`)
      }
      Sentry.captureException(err)
      this.logger.error({ err })
      throw err
    }
  }

  shutdown_streams() {
    if (this.closeUserWebsocket) this.logger.info(`Shutting down streams`)
    if (this.closeUserWebsocket) this.closeUserWebsocket()
  }

  async monitor_user_stream() {
    type processor_func = (data: ExecutionReport) => Promise<void>

    const process_execution_report: processor_func = async (data: ExecutionReport) => {
      try {
        if (data.eventType === "executionReport") {
          await this.callbacks.process_execution_report(data)
        } else {
          this.logger.error({}, `Ignoring eventType: ${(data as any).eventType}`)
        }
      } catch (err) {
        this.logger.exception({}, err)
        Sentry.withScope(function (scope) {
          scope.setTag("operation", "processExecutionReport")
          scope.setTag("market_symbol", data.symbol)
          scope.setTag("side", data.side)
          scope.setTag("orderType", data.orderType)
          scope.setTag("orderStatus", data.orderStatus)
          scope.setTag("executionType", data.executionType)
          Sentry.captureException(err)
        })
        this.send_message(`Error calling processExecutionReport for pair ${data.symbol}`)
      }
    }

    switch (this.exchange_identifier.exchange_type) {
      case "spot":
        this.closeUserWebsocket = await this.ee.ws.user(
          async (
            data:
              | OutboundAccountInfo
              | ExecutionReport
              | BalanceUpdate
              | OutboundAccountPosition
              | MarginCall
              | UserDataStreamEvent
          ) => {
            this.logger.info(data)
            if (data.eventType === "executionReport") {
              await process_execution_report(data)
            }
          }
        )
        break
      default:
        throw new Error(`Unknown exchange type: ${this.exchange_identifier.exchange_type}`)
    }
  }
}
