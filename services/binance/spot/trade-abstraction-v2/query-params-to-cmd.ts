import { strict as assert } from "assert"
import { Request, Response } from "express"
import { TradeAbstractionOpenSpotLongCommand, TradeAbstractionOpenSpotLongResult } from "./interfaces/open_spot"
import { Logger } from "../../../../interfaces/logger"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Tags } from "hot-shots"

export class QueryParamsToCmd {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  long(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V3 }
  ): {
    result: TradeAbstractionOpenSpotLongResult | TradeAbstractionOpenSpotLongCommand
    tags: { [key: string]: string }
  } {
    let { edge, base_asset, trigger_price, signal_timestamp_ms: signal_timestamp_ms_string } = req.query
    const direction = "long",
      action = "open"

    let tags: Tags = {
      direction,
      quote_asset,
      action,
      exchange_type: exchange_identifier.type,
    }

    /* input checking */
    try {
      assert(typeof edge == "string", new Error(`InputChecking: typeof edge unexpected`))
      tags.edge = edge

      assert(
        typeof trigger_price == "string" || typeof trigger_price == "undefined",
        new Error(`InputChecking: typeof trigger_price unexpected: ${typeof trigger_price}`)
      )
      assert(typeof base_asset == "string", new Error(`InputChecking: typeof base_asset unexpected`))
      tags.base_asset = base_asset
      assert(
        typeof signal_timestamp_ms_string == "string",
        new Error(`InputChecking: typeof signal_timestamp_ms unexpected: ${typeof signal_timestamp_ms_string}`)
      )
    } catch (err: any) {
      let result: TradeAbstractionOpenSpotLongResult = {
        object_type: "TradeAbstractionOpenSpotLongResult",
        version: 1,
        base_asset: base_asset as string,
        quote_asset,
        edge: edge as string,
        status: "BAD_INPUTS",
        http_status: 400,
        msg: `TradeAbstractionOpenSpotLongResult: ${edge}${base_asset}: BAD_INPUTS`,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
      }
      this.logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      this.logger.error({ err })
      return { result, tags }
    }

    let signal_timestamp_ms = Number(signal_timestamp_ms_string)

    let result: TradeAbstractionOpenSpotLongCommand = {
      object_type: "TradeAbstractionOpenLongCommand",
      edge,
      direction,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    return { result, tags }
  }
}
