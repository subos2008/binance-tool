import { Telegraf, Context, NarrowedContext, Types } from "telegraf"
import { Logger } from "../../interfaces/logger"
import { SpotTradeAbstractionServiceClient } from "../spot-trade-abstraction/client/tas-client"

let help_text = `
All trades are vs USD, the backend decides which USD evivalent asset to use, could be USDT or BUSD, etc

<b>Commands:</b>

To enter a long spot position:

  /spot long LINK [edge##] [STOP_PRICE]

To close an open long spot position:

  /spot close LINK [edge##]

To view open positions:

  /positions
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
    // bot.command("spot", Commands.spot)
    bot.on("text", this.text_to_command.bind(this))
  }

  async text_to_command(ctx: NarrowedContext<Context, Types.MountMap["text"]>) {
    let args = split_message(ctx.message.text)
    if (args[0] == "/spot") {
      await this.spot(ctx, args.slice(1))
    } else if (args[0] == "/positions") {
      await this.list_positions(ctx, args.slice(1))
    } else {
      ctx.reply(ctx.message.text)
    }
  }

  async list_positions(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let postions = await this.tas_client.positions()
    let msg = postions
      .map(
        (pi) => `${pi.exchange_identifier.exchange} ${pi.exchange_identifier.type} ${pi.base_asset.toUpperCase()}`
      )
      .join("\n")

    ctx.reply(msg)
  }

  async spot(ctx: NarrowedContext<Context, Types.MountMap["text"]>, args: string[]) {
    let [command, asset, edge] = args
    asset = asset.toUpperCase()
    let valid_commands = ["long", "close"]
    if (!valid_commands.includes(command)) {
      ctx.replyWithHTML(`Invalid command for /spot '${command}, valid commands are ${valid_commands.join(", ")}`)
      return
    }
    if (!edge || !edge.match(/edge\d+/)) {
      ctx.replyWithHTML(`Invalid format for edge '${edge}', expected something like edge60`)
      return
    }

    try {
      let result = await this.go_spot_long(ctx, { asset, edge })
      ctx.reply(`Looks like it succeeded?`)
      ctx.reply(`not implemented?`)
    } catch (error) {
      ctx.reply(`Looks like it failed, see log for error`)
    }
    // ctx.replyWithHTML("<i>Are you sure?</i>")
  }

  async go_spot_long(
    ctx: NarrowedContext<Context, Types.MountMap["text"]>,
    { asset, edge }: { asset: string; edge: string }
  ) {
    let msg = `${edge.toUpperCase()}: go_spot_long on ${asset}`
    ctx.reply(msg)
    let result: string = await this.tas_client.go_spot_long({ base_asset: asset, edge, direction: "long" })
    return result
  }
}

/**
 * Utility
 */
function split_message(msg: string) {
  return msg.split(/ /)
}
