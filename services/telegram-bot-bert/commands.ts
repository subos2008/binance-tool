import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { Logger } from "../../interfaces/logger"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"

import * as Sentry from "@sentry/node"
import {
  TradeAbstractionCloseSpotLongResult,
  TradeAbstractionOpenSpotLongCommand,
  TradeAbstractionOpenSpotLongResult,
} from "../spot-trade-abstraction/trade-abstraction-service"
import { AuthorisedEdgeType, check_edge } from "../../classes/spot/abstractions/position-identifier"
Sentry.init({})
// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", service_name)
// })

let help_text = `
All trades are vs USD, the backend decides which USD evivalent asset to use, could be USDT or BUSD, etc

<b>Commands:</b>

To enter a long spot position:

  /spot long LINK [edge##] [STOP_PRICE]

To close an open long spot position:

  /spot close LINK [edge##]

To view open positions:

  /positions

To check the bot is listening:

  /hi
`

/**
 * Probably add session here later
 */
export class Commands {
  tas_client: SpotTradeAbstractionServiceClient
  logger: Logger

  constructor({ bot, logger }: { bot: Telegraf; logger: Logger }) {
    this.logger = logger
    this.tas_client = new SpotTradeAbstractionServiceClient({ logger })
    // Set the bot response
    // Order is important
    bot.help((ctx) => ctx.replyWithHTML(help_text))
    bot.command("hi", (ctx) => {
      ctx.reply("Yep, I'm here!")
      console.info(JSON.stringify(ctx))
    })
    // bot.command("spot", Commands.spot)
    bot.on("text", this.text_to_command.bind(this))
  }

  async text_to_command(ctx: NarrowedContext<Context, Types.MountMap["text"]>) {
    try {
      let args = split_message(ctx.message.text)
      if (args[0] == "/spot") {
        await this.spot(ctx, args.slice(1))
      } else if (args[0] == "/positions") {
        await this.list_positions(ctx, args.slice(1))
      } else {
        // Not a command - just people speaking in a channel
        // ctx.reply(ctx.message.text)
      }
    } catch (error) {
      ctx.reply(`Internal error 🤪`)
    }
  }

  async list_positions(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let postions = await this.tas_client.positions()
    if (postions.length == 0) {
      ctx.reply(`No open positions.`)
      return
    }
    let msg = postions
      .map(
        (pi) => `${pi.exchange_identifier.exchange} ${pi.exchange_identifier.type} ${pi.base_asset.toUpperCase()}`
      )
      .join("\n")

    ctx.reply(msg)
  }

  async spot(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    try {
      let [command, base_asset, edge_unchecked] = args
      base_asset = base_asset.toUpperCase()
      let valid_commands = ["long", "close"]
      if (!valid_commands.includes(command)) {
        ctx.replyWithHTML(`Invalid command for /spot '${command}, valid commands are ${valid_commands.join(", ")}`)
        return
      }

      let edge: AuthorisedEdgeType
      try {
        edge = check_edge(edge_unchecked)
      } catch (err) {
        this.logger.error({ err })
        Sentry.captureException(err)
        ctx.replyWithHTML(`Invalid format for edge '${edge_unchecked}', expected something like edgeNN`)
        return
      }

      if (command == "long") {
        let signal_timestamp_ms = (+Date.now()).toString()
        let result: TradeAbstractionOpenSpotLongResult = await this.open_spot_long(ctx, {
          base_asset,
          edge,
          direction: "long",
          signal_timestamp_ms,
          action: "open",
        })
        ctx.reply(`Spot long entry on ${edge}:${base_asset}: ${result.status}`)
      }

      if (command == "close") {
        let result = await this.close_spot_long(ctx, { asset: base_asset, edge })
        ctx.reply(`Looks like it succeeded?`)
      }
    } catch (err) {
      this.logger.error({ err }, `Looks like command failed:`)
      Sentry.captureException(err)
      ctx.reply(`Looks like it failed, see log for error`)
    }
    // ctx.replyWithHTML("<i>Are you sure?</i>")
  }

  async open_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    cmd: TradeAbstractionOpenSpotLongCommand
  ): Promise<TradeAbstractionOpenSpotLongResult> {
    // let msg = `${cmd.edge.toUpperCase()}: opening spot long on ${cmd.base_asset} (unchecked)`
    // ctx.reply(msg)
    try {
      let result: TradeAbstractionOpenSpotLongResult = await this.tas_client.open_spot_long(cmd)
      return result
    } catch (err) {
      this.logger.error({ err })
      Sentry.captureException(err)
      throw err
    }
  }

  async close_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    { asset, edge }: { asset: string; edge: string }
  ) {
    let msg = `${edge.toUpperCase()}: closing spot long on ${asset}`
    ctx.reply(msg)
    let result: TradeAbstractionCloseSpotLongResult = await this.tas_client.close_spot_long({
      base_asset: asset,
      edge,
      direction: "long",
      action: "close",
    })
    return result
  }
}

/**
 * Utility
 */
function split_message(msg: string) {
  return msg.split(/ /)
}
