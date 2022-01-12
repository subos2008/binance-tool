import { Telegraf, Context } from "telegraf"
import { Logger } from "../../interfaces/logger"
import { BinanceSpotExecutionEngine } from "./execution-engine"
import { Positions } from "./positions"
import { TradeAbstractionService } from "./trade-abstraction-service"

/**
 * Config
 */
let global_quote_asset = "BSUD"

let help_text = `
All trades are vs USD, the backend decides which USD evivalent asset to use, could be USDT or BUSD, etc

<b>Commands:</b>

To enter a long spot position:

  /spot long LINK [edge##] [STOP_PRICE]

To close an open long spot position:

  /spot close LINK [edge##]
`

/**
 * Probably add session here later
 */
export class Commands {
  spot_trades: TradeAbstractionService

  constructor({ bot, logger }: { bot: Telegraf; logger: Logger }) {
    let spot_ee = new BinanceSpotExecutionEngine({ logger })
    let spot_positions = new Positions({ logger, ee: spot_ee })
    this.spot_trades = new TradeAbstractionService({
      logger,
      ee: spot_ee,
      quote_asset: global_quote_asset,
      positions: spot_positions,
    })
    // Set the bot response
    // Order is important
    bot.help((ctx) => ctx.replyWithHTML(help_text))
    bot.command("spot", Commands.spot)
    bot.on("text", (ctx) => ctx.replyWithHTML("<b>Hello?</b>"))

    const parser = require("yargs")
      .usage("/<cmd> [args]")
      .command(
        "spot [op] [asset] [edge]",
        "welcome ter yargs!",
        (yargs: any) => {
          yargs
            .positional("op", {
              type: "string",
              choices: ["long", "close"],
              describe: "whether to buy (long) or close an open position",
            })
            .positional("asset", {
              type: "string",
              choices: ["long", "close"],
              describe: "whether to buy (long) or close an open position",
            })
            .positional("edge", {
              type: "string",
              choices: ["edge60"],
              describe: "name of the edge signal we are trading",
            })
        },
        function (argv: any) {
          console.log("hello", argv.op, "welcome to yargs!")
        }
      )
      .demand(1)
      .strict()
      .help()
    // .epilog("To the moon")
  }

  static spot(context: Context) {
    // run the yargs parser on the inbound slack command.
    parser.parse(req.body.text || "", context, (err, argv, output) => {
      if (err) logger.error(err.message)
      if (output) argv.respond(output)
    })
    let args
    /**
     * Get open positions, ---- this is to check we aren't already in a position
     * check we aren't in a position, ---- this is to check we aren't already in a position
     * Get the position size, -- this can be hardcoded, just needs price or to specify quote amount to spend
     * Try and execute a buy on that position size
     * Create sell order at the stop price for any amount that was executed for the buy
     */
    // ctx.replyWithHTML("<i>Are you sure?</i>")
  }
}

/**
 * Utility
 */
function split_spot_message(msg: string) {
  let args = msg.split(/ /)
}
