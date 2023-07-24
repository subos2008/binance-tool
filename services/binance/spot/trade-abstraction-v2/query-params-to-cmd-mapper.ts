import { strict as assert } from "assert"
import { Request } from "express"
import { TradeAbstractionOpenLongCommand, TradeAbstractionOpenLongResult } from "./interfaces/long"
import { ServiceLogger } from "../../../../interfaces/logger"
import { ExchangeIdentifier_V3, ExchangeIdentifier_V4 } from "../../../../events/shared/exchange-identifier"
import { TradeAbstractionCloseCommand, TradeAbstractionCloseResult } from "./interfaces/close"
import { TradeAbstractionMoveStopCommand, TradeAbstractionMoveStopResult } from "./interfaces/move_stop"
import {
  TradeContext,
  TradeContext_with_optional_trade_id,
} from "../../../../interfaces/exchanges/spot-execution-engine"

type Tags = { [key: string]: string }

export class QueryParamsToCmdMapper {
  logger: ServiceLogger

  constructor({ logger }: { logger: ServiceLogger }) {
    this.logger = logger
  }

  /* You have to catch exceptions in the calling code */

  get_param_must_be_non_empty_string_OR_THROW(req: Request, param_name: string): string {
    let value = req.query[param_name]
    assert(
      typeof value == "string",
      new Error(`InputChecking: typeof ${param_name} unexpected, got ${typeof value}`)
    )
    assert(!value, new Error(`InputChecking: ${param_name} is the empty string: '${value}'`))
    return value
  }
  get_OPTIONAL_param_must_be_non_empty_string(req: Request, param_name: string): string | undefined {
    let value = req.query[param_name]
    if (!value) return
    assert(
      typeof value == "string",
      new Error(`InputChecking: typeof ${param_name} unexpected, got ${typeof value}`)
    )
    return value
  }

  get_base_asset(req: Request): string {
    return this.get_param_must_be_non_empty_string_OR_THROW(req, "base_asset")
  }
  get_edge(req: Request): string {
    return this.get_param_must_be_non_empty_string_OR_THROW(req, "edge")
  }

  get_trade_id(req: Request): string | undefined {
    return this.get_OPTIONAL_param_must_be_non_empty_string(req, "trade_id")
  }

  get_new_stop_price(req: Request): string {
    return this.get_param_must_be_non_empty_string_OR_THROW(req, "new_stop_price")
  }
  get_trigger_price(req: Request): string {
    return this.get_param_must_be_non_empty_string_OR_THROW(req, "trigger_price")
  }
  get_signal_timestamp_ms(req: Request): number {
    let signal_timestamp_ms_string = this.get_OPTIONAL_param_must_be_non_empty_string(req, "signal_timestamp_ms")
    if (typeof signal_timestamp_ms_string == "undefined") {
      return Date.now()
    }
    if (typeof signal_timestamp_ms_string == "string") {
      return Number(signal_timestamp_ms_string)
    }
    if (typeof signal_timestamp_ms_string == "number") {
      return Number(signal_timestamp_ms_string)
    }

    throw new Error(`InputChecking: typeof signal_timestamp_ms unexpected: ${typeof signal_timestamp_ms_string}`)
  }

  get_trade_context(req: Request): {
    base_asset: string
    edge: string
    trade_id?: string // Not known and needs looking up except when passed for opening trades
  } {
    /**
     * We are moving to having a TradeContext in objects instead of having all these
     * values at the top level.
     */
    if (req.query["trade_context"]) {
      let json = req.query["trade_context"]?.toString()
      this.logger.info(`QueryParamsToCmdMapper: Got trade_context: ${json}`)
      if (json) {
        let trade_context: TradeContext = JSON.parse(json)
        if (!trade_context.edge) throw new Error(`edge missing in trade_context`)
        if (!trade_context.base_asset) throw new Error(`base_asset missing in trade_context`)
        // TODO: this code path has less input validation
        return trade_context
      }
    } else {
      this.logger.info(
        `QueryParamsToCmdMapper: No trade_context, looking in object top level for base_asset and edge`
      )
    }

    /* Handle the OG case of all values at the top of the object */
    return { base_asset: this.get_base_asset(req), edge: this.get_edge(req), trade_id: this.get_trade_id(req) }
  }

  close(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V4 }
  ): {
    result: TradeAbstractionCloseResult | TradeAbstractionCloseCommand
    tags: { [key: string]: string }
  } {
    const action = "close"

    let tags: Tags = {
      quote_asset,
      action,
      exchange_type: exchange_identifier.exchange_type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let edge: string, base_asset: string, signal_timestamp_ms: number, trigger_price: string
    try {
      edge = this.get_edge(req)
      base_asset = this.get_base_asset(req)
      signal_timestamp_ms = this.get_signal_timestamp_ms(req)
      trigger_price = this.get_trigger_price(req)
    } catch (err: any) {
      let inputs = JSON.stringify(req.query)
      let msg = `Result: BAD_INPUTS (got: ${inputs})`
      this.logger.exception(tags, err, msg)
      let result: TradeAbstractionCloseResult = {
        object_type: "TradeAbstractionCloseResult",
        object_class: "result",
        version: 1,
        quote_asset,
        action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg,
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
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V4 }
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
      exchange_type: exchange_identifier.exchange_type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let edge: string,
      base_asset: string,
      signal_timestamp_ms: number,
      trigger_price: string,
      trade_id: string | undefined
    try {
      edge = this.get_edge(req)
      base_asset = this.get_base_asset(req)
      signal_timestamp_ms = this.get_signal_timestamp_ms(req)
      trigger_price = this.get_trigger_price(req)
      trade_id = this.get_trade_id(req)
    } catch (err: any) {
      let inputs = JSON.stringify(req.query)
      let msg = `Result: BAD_INPUTS (got: ${inputs})`
      this.logger.exception(tags, err, msg)
      let result: TradeAbstractionOpenLongResult = {
        object_type: "TradeAbstractionOpenLongResult",
        object_class: "result",
        version: 1,
        quote_asset,
        direction,
        action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg,
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

  move_stop(
    req: Request,
    {
      cmd_received_timestamp_ms,
      quote_asset,
      exchange_identifier,
    }: { cmd_received_timestamp_ms: number; quote_asset: string; exchange_identifier: ExchangeIdentifier_V4 }
  ): {
    result: TradeAbstractionMoveStopResult | TradeAbstractionMoveStopCommand
    tags: { [key: string]: string }
  } {
    const action = "move_stop"

    let tags: Tags = {
      quote_asset,
      action,
      exchange_type: exchange_identifier.exchange_type,
      exchange: exchange_identifier.exchange,
    }

    /* input checking */
    let signal_timestamp_ms: number = 0,
      new_stop_price: string,
      trade_context: TradeContext_with_optional_trade_id
    try {
      signal_timestamp_ms = this.get_signal_timestamp_ms(req)
      new_stop_price = this.get_new_stop_price(req)
      trade_context = this.get_trade_context(req)
    } catch (err: any) {
      let inputs = JSON.stringify(req.query)
      let msg = `Result: BAD_INPUTS (got: ${inputs}): ${err.msg}`
      this.logger.exception(tags, err, msg)
      let result: TradeAbstractionMoveStopResult = {
        object_type: "TradeAbstractionMoveStopResult",
        object_class: "result",
        version: 1,
        action,
        status: "BAD_INPUTS",
        http_status: 400,
        msg,
        err,
        execution_timestamp_ms: cmd_received_timestamp_ms,
        signal_timestamp_ms,
      }
      this.logger.result({ ...tags, level: "error" }, result, "created")
      return { result, tags }
    }

    let result: TradeAbstractionMoveStopCommand = {
      object_type: "TradeAbstractionMoveStopCommand",
      object_class: "command",
      action,
      new_stop_price,
      signal_timestamp_ms,
      trade_context,
    }
    this.logger.command(tags, result, "created")
    return { result, tags }
  }
}
