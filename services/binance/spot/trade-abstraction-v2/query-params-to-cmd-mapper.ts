import { strict as assert } from "assert"
import { Request, Response } from "express"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import { TradeAbstractionOpenShortCommand, TradeAbstractionOpenShortResult } from "./interfaces/short"
import { Logger } from "../../../../interfaces/logger"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"
// import { Tags } from "hot-shots"

type Tags = { [key: string]: string }

export class QueryParamsToCmdMapper {
  logger: Logger

  constructor({ logger }: { logger: Logger }) {
    this.logger = logger
  }

  /* You have to catch exceptions in the calling code */
  check_inputs(
    req: Request,
    tags: Tags,
    { cmd_received_timestamp_ms, quote_asset }: { cmd_received_timestamp_ms: number; quote_asset: string }
  ): {
    edge: string
    base_asset: string
    signal_timestamp_ms: number
    trigger_price: string | undefined
    tags: Tags
  } {
    let { edge, base_asset, trigger_price, signal_timestamp_ms: signal_timestamp_ms_string } = req.query

    assert(typeof edge == "string", new Error(`InputChecking: typeof edge unexpected`))
    tags.edge = edge

    assert(
      typeof trigger_price == "string" || typeof trigger_price == "undefined",
      new Error(`InputChecking: typeof trigger_price unexpected: ${typeof trigger_price}`)
    )
    assert(typeof base_asset == "string", new Error(`InputChecking: typeof base_asset unexpected`))
    tags.base_asset = base_asset

    if (typeof signal_timestamp_ms_string == "undefined") {
      signal_timestamp_ms_string = Date.now().toString()
    }

    assert(
      typeof signal_timestamp_ms_string == "string",
      new Error(`InputChecking: typeof signal_timestamp_ms unexpected: ${typeof signal_timestamp_ms_string}`)
    )

    let signal_timestamp_ms = Number(signal_timestamp_ms_string)

    return { edge, base_asset, signal_timestamp_ms, trigger_price, tags }
  }

  close(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V3 }
  ): {
    result: TradeAbstractionCloseResult | TradeAbstractionCloseCommand
    tags: { [key: string]: string }
  } {
    const action = "close"

    let tags: Tags = {
      quote_asset,
      action,
      exchange_type: exchange_identifier.type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let edge, base_asset, signal_timestamp_ms, trigger_price
    try {
      ;({ edge, base_asset, signal_timestamp_ms, trigger_price } = this.check_inputs(req, tags, {
        cmd_received_timestamp_ms,
        quote_asset,
      }))
    } catch (err: any) {
      let result: TradeAbstractionCloseResult = {
        object_type: "TradeAbstractionCloseResult",
        version: 1,
        base_asset,
        quote_asset,
        edge,
        action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg: `TradeAbstractionCloseResult: ${edge}${base_asset}: BAD_INPUTS`,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
      }
      this.logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      this.logger.error({ err })
      this.logger.error({ ...tags, ...result })
      return { result, tags }
    }

    let result: TradeAbstractionCloseCommand = {
      object_type: "TradeAbstractionCloseCommand",
      version: 1,
      edge,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    this.logger.info({ ...tags, ...result })

    return { result, tags }
  }

  long(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V3 }
  ): {
    result: TradeAbstractionOpenLongResult | TradeAbstractionOpenLongCommand
    tags: { [key: string]: string }
  } {
    const direction = "long",
      action = "open"

    let tags: Tags = {
      direction,
      quote_asset,
      action,
      exchange_type: exchange_identifier.type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let edge, base_asset, signal_timestamp_ms, trigger_price
    try {
      ;({ edge, base_asset, signal_timestamp_ms, trigger_price } = this.check_inputs(req, tags, {
        cmd_received_timestamp_ms,
        quote_asset,
      }))
    } catch (err: any) {
      let result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        version: 1,
        base_asset,
        quote_asset,
        edge,
        direction,
        action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg: `TradeAbstractionOpenLongResult: ${edge}${base_asset}: BAD_INPUTS`,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
      }
      this.logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      this.logger.error({ err })
      this.logger.error({ ...tags, ...result })
      return { result, tags }
    }

    let result: TradeAbstractionOpenLongCommand = {
      object_type: "TradeAbstractionOpenLongCommand",
      edge,
      direction,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    this.logger.info({ ...tags, ...result })
    return { result, tags }
  }

  short(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V3 }
  ): {
    result: TradeAbstractionOpenShortResult | TradeAbstractionOpenShortCommand
    tags: { [key: string]: string }
  } {
    const direction = "short",
      action = "open"

    let tags: Tags = {
      direction,
      quote_asset,
      action,
      exchange_type: exchange_identifier.type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let edge, base_asset, signal_timestamp_ms, trigger_price
    try {
      ;({ edge, base_asset, signal_timestamp_ms, trigger_price } = this.check_inputs(req, tags, {
        cmd_received_timestamp_ms,
        quote_asset,
      }))
    } catch (err: any) {
      let result: TradeAbstractionOpenShortResult = {
        object_type: "TradeAbstractionOpenShortResult",
        version: 1,
        base_asset,
        quote_asset,
        edge,
        // direction,
        // action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg: `TradeAbstractionOpenSpotShortResult: ${edge}${base_asset}: BAD_INPUTS`,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
      }
      this.logger.error(
        `400 due to bad inputs '${req.query.edge}' attempting to open ${req.query.base_asset}: ${err.message}`
      )
      this.logger.error({ err })
      this.logger.error({ ...tags, ...result })
      return { result, tags }
    }

    let result: TradeAbstractionOpenShortCommand = {
      object_type: "TradeAbstractionOpenShortCommand",
      edge,
      direction,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
      quote_asset,
    }
    this.logger.info({ ...tags, ...result })
    return { result, tags }
  }
}
