import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { Logger } from "../../interfaces/logger"
import { TradeAbstractionServiceClient } from "../binance/spot/trade-abstraction-v2/client/tas-client"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"
import { Commands_Futures } from "./commands/futures"
import Sentry from "../../lib/sentry"
import {
  TradeAbstractionOpenLongCommand,
  TradeAbstractionOpenLongResult,
} from "../binance/spot/trade-abstraction-v2/interfaces/long"
import { TradeAbstractionCloseResult } from "../binance/spot/trade-abstraction-v2/interfaces/close"
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
  logger: Logger

  // commands
  futures: Commands_Futures

  constructor({ bot, logger }: { bot: Telegraf; logger: Logger }) {
    this.logger = logger
    this.spot_tas_client = new TradeAbstractionServiceClient({ logger, TAS_URL })
    // Set the bot response
    // Order is important
    bot.help((ctx) => ctx.replyWithHTML(help_text))
    bot.command("hi", (ctx) => {
      ctx.reply("Yep, I'm here!")
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
      } else if (args[0] == "/futures") {
        await this.futures.futures(ctx)
      } else {
        // Not a command - just people speaking in a channel
        ctx.reply(`Unrecognised: ${ctx.message.text}`)
      }
    } catch (err) {
      ctx.reply(`Internal error 🤪`)
    }
  }

  async list_positions(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let postions = await this.spot_tas_client.positions()
    if (postions.length == 0) {
      ctx.reply(`No open positions.`)
      return
    }
    let msg = postions
      .map(
        (pi) =>
          `${pi.exchange_identifier.exchange} ${pi.exchange_identifier.type}  ${
            pi.edge
          }:${pi.base_asset.toUpperCase()}`
      )
      .join("\n")

    ctx.reply(msg)
  }

  async spot(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    try {
      let [command, edge_unchecked, base_asset] = args
      base_asset = base_asset.toUpperCase()
      let valid_commands = ["long", "close"]
      if (!valid_commands.includes(command)) {
        ctx.replyWithHTML(`Invalid command for /spot '${command}, valid commands are ${valid_commands.join(", ")}`)
        return
      }

      if (command == "long") {
        let edge: AuthorisedEdgeType
        try {
          edge = check_edge(edge_unchecked)
        } catch (err) {
          this.logger.error({ err })
          Sentry.captureException(err)
          ctx.replyWithHTML(`Invalid format for edge '${edge_unchecked}', expected something like edgeNN`)
          return
        }
        let signal_timestamp_ms = Date.now()
        let result: TradeAbstractionOpenLongResult = await this.spot_tas_client.long({
          object_type: "TradeAbstractionOpenLongCommand",
          base_asset,
          edge,
          direction: "long",
          signal_timestamp_ms,
          action: "open",
        })
        ctx.reply(`Spot long entry on ${edge}:${base_asset}: ${result.status}`)
      }

      if (command == "close") {
        let edge = edge_unchecked
        let result = await this.close_spot_long(ctx, { asset: base_asset, edge })
        ctx.reply(`Spot long close on ${edge}:${base_asset}: ${result.status}`)
      }
    } catch (err: any) {
      this.logger.error({ err }, `Looks like command failed: ${err.message}`)
      Sentry.captureException(err)
      ctx.reply(`Looks like it failed, see log for error`)
    }
    // ctx.replyWithHTML("<i>Are you sure?</i>")
  }

  async close_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    { asset, edge }: { asset: string; edge: string }
  ): Promise<TradeAbstractionCloseResult> {
    let msg = `${edge.toUpperCase()}: closing spot long on ${asset}`
    ctx.reply(msg)
    let result: TradeAbstractionCloseResult = await this.spot_tas_client.close({
      object_type: "TradeAbstractionCloseCommand",
      version: 1,
      base_asset: asset,
      edge,
      action: "close",
      signal_timestamp_ms: Date.now(),
    })
    ctx.reply(`Spot long close on ${edge}:${asset}: ${result.status}`)
    return result
  }
}

/**
 * Utility
 */
function split_message(msg: string) {
  return msg.split(/ /)
}
