import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { FuturesTradeAbstractionServiceClient } from "../../binance/futures/trade-abstraction/client/tas-client"
import { Logger } from "../../../interfaces/logger"
import { AuthorisedEdgeType, check_edge } from "../../../classes/spot/abstractions/position-identifier"
import * as Sentry from "@sentry/node"
import {
  TradeAbstractionOpenFuturesShortCommand,
  TradeAbstractionOpenFuturesShortCommand_OCO_Exit,
  TradeAbstractionOpenFuturesShortResult,
} from "../../binance/futures/trade-abstraction/interfaces/open_futures_short"

export class Commands_Futures {
  futures_tas_client: FuturesTradeAbstractionServiceClient
  logger: Logger

  constructor(args: { bot: Telegraf; logger: Logger }) {
    this.logger = args.logger
    this.futures_tas_client = new FuturesTradeAbstractionServiceClient(args)
    args.bot.command("futures", (ctx) => {
      ctx.reply(`Futures handler processing message: ${ctx.message.text}`)
      this.logger.info(ctx)
      this.futures(ctx)
    })
  }

  async futures(ctx: NarrowedContext<Context, Types.MountMap["text"]>) {
    try {
      // let [command, base_asset, edge_unchecked, stop_price, tp_price] =
      let args: string[] = ctx.message.text.split(/ /).slice(1)
      let command = args.shift()

      switch (command) {
        case "short":
          let check_void: Promise<void> = this.open_short(ctx, args)
          break
        // case "close":
        //   let result = await this.close_futures_short(ctx, { asset: base_asset, edge })
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
    let signal_timestamp_ms = (+Date.now()).toString()
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
    let cmd: TradeAbstractionOpenFuturesShortCommand = {
      object_type: "TradeAbstractionOpenFuturesShortCommand",
      base_asset,
      edge,
      direction: "short",
      action: "open",
      signal_timestamp_ms,
    }

    try {
      let result: TradeAbstractionOpenFuturesShortResult = await this.futures_tas_client.open_short(cmd)
      ctx.reply(`${result.msg}`)
      return
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      ctx.reply(`Exception caught.`)
    }
  }
}
