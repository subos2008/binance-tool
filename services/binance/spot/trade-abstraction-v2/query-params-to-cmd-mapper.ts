import { strict as assert } from "assert"
import { Request } from "express"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import { ServiceLogger } from "../../../../interfaces/logger"
import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"

type Tags = { [key: string]: string }

export class QueryParamsToCmdMapper {
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
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
    trade_id?: string
  } {
    let {
      edge,
      base_asset,
      trigger_price,
      signal_timestamp_ms: signal_timestamp_ms_string,
      trade_id: trade_id_input,
    } = req.query

    assert(typeof edge == "string", new Error(`InputChecking: typeof edge unexpected`))
    tags.edge = edge

    // only get this on longs at the moment, needs sourcing for short and close
    let trade_id: string | undefined
    if (typeof trade_id_input == "string") {
      trade_id = trade_id_input
      // assert(typeof trade_id_input == "string", new Error(`InputChecking: typeof trade_id unexpected`))
      assert(trade_id !== "", new Error(`InputChecking: trade_id was the empty string`))
      tags.trade_id = trade_id
    }

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

    return { edge, base_asset, signal_timestamp_ms, trigger_price, tags, trade_id }
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
      this.logger.exception(tags, err)
      let result: TradeAbstractionCloseResult = {
        object_type: "TradeAbstractionCloseResult",
        object_class: "result",
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
      this.logger.result({ ...tags, level: "error" }, result, "created")
      return { result, tags }
    }

    let result: TradeAbstractionCloseCommand = {
      object_type: "TradeAbstractionCloseCommand",
      object_class: "command",
      version: 1,
      edge,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    this.logger.command(tags, result, "created")
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
    let edge, base_asset, signal_timestamp_ms, trigger_price, trade_id
    try {
      ;({ edge, base_asset, signal_timestamp_ms, trigger_price, trade_id } = this.check_inputs(req, tags, {
        cmd_received_timestamp_ms,
        quote_asset,
      }))
    } catch (err: any) {
      this.logger.exception(tags, err)
      let result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        object_class: "result",
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
      this.logger.result({ ...tags, level: "error" }, result, "created")
      return { result, tags }
    }

    assert(typeof trade_id == "string", new Error(`InputChecking: typeof trade_id unexpected`))

    let result: TradeAbstractionOpenLongCommand = {
      object_type: "TradeAbstractionOpenLongCommand",
      object_class: "command",
      edge,
      trade_id,
      direction,
      action,
      base_asset,
      trigger_price,
      signal_timestamp_ms,
    }
    this.logger.command(tags, result, "created")
    return { result, tags }
  }
}
