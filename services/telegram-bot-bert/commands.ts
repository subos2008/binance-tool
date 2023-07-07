import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { Logger, ServiceLogger } from "../../interfaces/logger"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"
import { Commands_Futures } from "./commands/futures"
import Sentry from "../../lib/sentry"
import {
  generate_trade_id,
  TradeAbstractionOpenLongCommand,
  TradeAbstractionOpenLongResult,
} from "../binance/spot/trade-abstraction-v2/interfaces/long"
import {
  TradeAbstractionCloseCommand,
  TradeAbstractionCloseResult,
} from "../binance/spot/trade-abstraction-v2/interfaces/close"
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

let help_text = `
All trades are vs USD, the backend decides which USD evivalent asset to use, could be USDT or BUSD, etc

<b>Commands:</b>

To enter a long spot position:

  /spot long [edgeNN] LINK [STOP_PRICE]

To close an open long spot position:

  /spot close [edgeNN] LINK 

Futures positions:

  /futures short [edgeNN] LINK
  /futures short [edgeNN] LINK
  /futures close [edgeNN] LINK (Not implemented?)

To view open spot positions:

  /positions

To check the bot is listening:

  /hi
`

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

/**
 * Probably add session here later
 */
export class Commands {
  spot_tas_client: TradeAbstractionServiceClient
  logger: ServiceLogger

  // commands
  futures: Commands_Futures

  constructor({ bot, logger }: { bot: Telegraf; logger: ServiceLogger }) {
    this.logger = logger
    this.spot_tas_client = new TradeAbstractionServiceClient({ logger, TAS_URL })
    // Set the bot response
    // Order is important
    bot.help((ctx) => ctx.replyWithHTML(help_text))
    bot.command("hi", async (ctx) => {
      await ctx.reply("Yep, I'm here!")
      console.info(JSON.stringify(ctx))
    })
    // bot.command("spot", Commands.spot)
    bot.on("text", this.text_to_command.bind(this))
    this.futures = new Commands_Futures({ logger, bot })
  }

  async text_to_command(ctx: NarrowedContext<Context, Types.MountMap["text"]>) {
    try {
      let args = split_message(ctx.message.text)
      if (false) {
      } else if (args[0] == "/spot") {
        await this.spot(ctx, args.slice(1))
      } else if (args[0] == "/positions") {
        await this.list_positions(ctx, args.slice(1))
      } else if (args[0] == "/move-stop") {
        await this.move_stop(ctx, args.slice(1))
      } else if (args[0] == "/futures") {
        await this.futures.futures(ctx)
      } else {
        // Not a command - just people speaking in a channel
        // await  ctx.reply(`Unrecognised: ${ctx.message.text}`)
      }
    } catch (err) {
      await ctx.reply(`Internal error 🤪`)
    }
  }

  async list_positions(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let postions = await this.spot_tas_client.positions()
    if (postions.length == 0) {
      await ctx.reply(`No open positions.`)
      return
    }
    let msg = postions
      .map(
        (pi) =>
          `${pi.exchange_identifier.exchange} ${pi.exchange_identifier.exchange_type}  ${
            pi.edge
          }:${pi.base_asset.toUpperCase()}`
      )
      .join("\n")

    await ctx.reply(msg)
  }

  // async move_stop(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
  //   let postions = await this.spot_tas_client.positions()
  //   if (postions.length == 0) {
  //     ctx.reply(`No open positions.`)
  //     return
  //   }
  //   let msg = postions
  //     .map(
  //       (pi) =>
  //         `${pi.exchange_identifier.exchange} ${pi.exchange_identifier.exchange_type}  ${
  //           pi.edge
  //         }:${pi.base_asset.toUpperCase()}`
  //     )
  //     .join("\n")

  //   await ctx.reply(msg)
  // }

  async spot(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let [command, edge_unchecked, base_asset] = args
    let tags = { edge: edge_unchecked, base_asset }
    try {
      base_asset = base_asset.toUpperCase()
      let valid_commands = ["long", "close"]
      if (!valid_commands.includes(command)) {
        await ctx.replyWithHTML(
          `Invalid command for /spot '${command}, valid commands are ${valid_commands.join(", ")}`
        )
        return
      }

      if (command == "long") {
        await this.open_spot_long(ctx, { base_asset, edge: edge_unchecked })
      }

      if (command == "close") {
        await this.close_spot_long(ctx, { base_asset, edge: edge_unchecked })
      }

      throw new Error(`Invalid command`)
    } catch (err: any) {
      this.logger.exception(tags, err, `Looks like command failed: ${err.message}`)
      Sentry.captureException(err)
      await ctx.reply(`Looks like it failed: ${err.message}`)
    }
  }

  async open_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    { base_asset, edge }: { base_asset: string; edge: string }
  ): Promise<void> {
    const direction = "long"
    let tags = { edge, base_asset, direction }
    let signal_timestamp_ms = Date.now()
    let trade_id = generate_trade_id({ edge, base_asset, direction, signal_timestamp_ms })
    let cmd: TradeAbstractionOpenLongCommand = {
      object_type: "TradeAbstractionOpenLongCommand",
      object_class: "command",
      base_asset,
      edge,
      trade_id,
      direction,
      signal_timestamp_ms,
      action: "open",
    }
    this.logger.command(tags, cmd, "created")
    let result: TradeAbstractionOpenLongResult = await this.spot_tas_client.long(cmd)
    await ctx.reply(`Spot long entry on ${edge}:${base_asset}: ${result.status}`)
    this.logger.result(tags, result, "consumed")
  }

  async close_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    { base_asset, edge }: { base_asset: string; edge: string }
  ): Promise<void> {
    let tags = { edge, base_asset }
    let msg = `${edge.toUpperCase()}: closing spot long on ${base_asset}`
    await ctx.reply(msg)
    let cmd: TradeAbstractionCloseCommand = {
      object_type: "TradeAbstractionCloseCommand",
      object_class: "command",
      version: 1,
      base_asset,
      edge,
      action: "close",
      signal_timestamp_ms: Date.now(),
    }
    this.logger.command(tags, cmd, "created")
    let result: TradeAbstractionCloseResult = await this.spot_tas_client.close(cmd)
    this.logger.result(tags, result, "consumed")
    await ctx.reply(`Spot long close on ${edge}:${base_asset}: ${result.status}`)
  }
}

/**
 * Utility
 */
function split_message(msg: string) {
  return msg.split(/ /)
}
