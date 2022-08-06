import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { TradeAbstractionServiceClient } from "../../binance/futures/trade-abstraction/client/tas-client"
import { Logger } from "../../../interfaces/logger"
import Sentry from "../../../lib/sentry"
import {
  TradeAbstractionOpenShortCommand,
  TradeAbstractionOpenShortResult,
} from "../../binance/futures/trade-abstraction/interfaces/short"
import {
  TradeAbstractionCloseCommand,
  TradeAbstractionCloseResult,
} from "../../binance/futures/trade-abstraction/interfaces/close"

export class Commands_Futures {
  futures_tas_client: TradeAbstractionServiceClient
  logger: Logger

  constructor(args: { bot: Telegraf; logger: Logger }) {
    this.logger = args.logger
    this.futures_tas_client = new TradeAbstractionServiceClient({
      ...args,
      TAS_URL: process.env.FUTURES_TRADE_ABSTRACTION_SERVICE_URL,
    })
    args.bot.command("futures", (ctx) => {
      ctx.reply(`Futures handler processing message: ${ctx.message.text}`)
      this.logger.info(ctx)
      this.futures(ctx)
    })
  }

  async futures(ctx: NarrowedContext<Context, Types.MountMap["text"]>) {
    try {
      // let [command, base_asset, edge_unchecked, stop_price, tp_price] =
      let args: string[] = ctx.message.text.split(/ /)
      let foo: string = args[0]
      if (args[0] !== "/futures") {
        ctx.reply(`Expected /futures, got ${foo}`)
      }
      args = args.slice(1)
      let command = args.shift()

      switch (command) {
        case "short":
          let check_void: void = await this.open_short(ctx, args)
          break
        case "close":
          let result: void = await this.close(ctx, args)
        // case "positions":
        //   let result = await this.close(ctx, { asset: base_asset, edge })
        //   ctx.reply(`Futures short close on ${edge}:${base_asset}: ${result.status}`)
        default:
          ctx.reply(`Command not recognised: ${command}`)
          return
      }
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      ctx.reply(`Exception caught.`)
      return
    }
  }

  // This should not throw or return anything interesting
  async open_short(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]): Promise<void> {
    try {
      let signal_timestamp_ms = Date.now()
      let base_asset = args.shift()?.toUpperCase()
      let edge = args.shift()
      if (!edge) {
        ctx.reply(`edge not defined.`)
        return
      }

      if (!base_asset) {
        ctx.reply(`base_asset not defined.`)
        return
      }

      let cmd: TradeAbstractionOpenShortCommand = {
        object_type: "TradeAbstractionOpenShortCommand",
        base_asset,
        edge,
        direction: "short",
        action: "open",
        signal_timestamp_ms,
      }

      let result: TradeAbstractionOpenShortResult = await this.futures_tas_client.short(cmd)
      ctx.reply(`Futures short opened on ${edge}:${base_asset}: ${result.status}`)
      ctx.reply(`${result.msg}`)
      return
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      ctx.reply(`Exception caught.`)
    }
  }

  // This should not throw or return anything interesting
  async close(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]): Promise<void> {
    try {
      let signal_timestamp_ms = Date.now()
      let base_asset = args.shift()?.toUpperCase()
      let edge = args.shift()
      if (!edge) {
        ctx.reply(`edge not defined.`)
        return
      }
      if (!base_asset) {
        ctx.reply(`base_asset not defined.`)
        return
      }
      let cmd: TradeAbstractionCloseCommand = {
        object_type: "TradeAbstractionCloseCommand",
        version: 1,
        base_asset,
        edge,
        action: "close",
        signal_timestamp_ms,
      }

      let result: TradeAbstractionCloseResult = await this.futures_tas_client.close(cmd)
      ctx.reply(`${result.msg}`)
      return
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      ctx.reply(`Exception caught.`)
    }
  }

  // This should not throw or return anything interesting
  async positions(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]): Promise<void> {
    try {
      let signal_timestamp_ms = Date.now()
      let base_asset = args.shift()?.toUpperCase()
      if (!base_asset) {
        ctx.reply(`base_asset not defined.`)
        return
      }
      let edge = args.shift()
      if (!edge) {
        ctx.reply(`edge not defined.`)
        return
      }
      let cmd: TradeAbstractionOpenShortCommand = {
        object_type: "TradeAbstractionOpenShortCommand",
        base_asset,
        edge,
        direction: "short",
        action: "open",
        signal_timestamp_ms,
      }

      let result: TradeAbstractionOpenShortResult = await this.futures_tas_client.short(cmd)
      ctx.reply(`${result.msg}`)
      return
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      ctx.reply(`Exception caught.`)
    }
  }
}
