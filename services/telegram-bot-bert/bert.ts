#!./node_modules/.bin/ts-node
/* eslint-disable no-console */

const service_name = "telegram-bot-bert"

// require("dotenv").config()

// As this is an exposed ingress service, prevent stack traces in express renders
process.env.NODE_ENV = "production"
process.env.PORT = "80"
const telegram_users_who_can_use_bot: string[] = ["slyph", "MehranRezghi"]

import Sentry from "../../lib/sentry"
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

import express, { Request, Response } from "express"
import { Telegraf } from "telegraf"
import { Commands } from "./commands"
import { BunyanServiceLogger } from "../../lib/service-logger"
import { ServiceLogger } from "../../interfaces/logger"
import { User } from "telegraf/typings/core/types/typegram"

const token = process.env.TELEGRAM_KEY
if (token === undefined) {
  throw new Error("TELEGRAM_KEY must be provided!")
}

const TAS_URL = process.env.SPOT_TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("SPOT_TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

const logger: ServiceLogger = new BunyanServiceLogger({ silent: false })
logger.event({}, { object_class: "event", object_type: "ServiceStarting", msg: "Service starting" })

var app = express()
var bodyParser = require("body-parser")

app.use(bodyParser.json()) // for parsing application/json
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
) // for parsing application/x-www-form-urlencoded

/**
 * Docs: https://telegraf.js.org/
 */
const bot = new Telegraf(token)
const commands = new Commands({ bot, logger })

/**
 * Error handler: not we are told not to just eat all the exceptions in the README.
 * Especially we shouldn't eat TimeoutError - but that's exactly the one I want to eat,
 * Because it causes infinite retries of messages
 */
bot.catch((err) => {
  Sentry.captureException(err)
  logger.error({ err })
  throw err // docs suggest not to eat errors, let's rethrow until we understand why
})

// Register logger middleware
bot.use((ctx, next) => {
  const start = Date.now()
  return next().then(() => {
    const ms = Date.now() - start
    console.log("response time %sms", ms)
  })
})

// Register authorisation middleware
// How to implement? We can null message and not call next(), return instead
bot.use((ctx, next) => {
  let user: User | undefined = ctx.from
  console.log(`message from ${user}`)
  if (!user?.username) throw new Error(`username is not defined in ctx.from`)
  if (!telegram_users_who_can_use_bot.includes(user.username)) return next().then(() => {})
})

// Need to get this working with bot.launch
// app.get("/health", function (req: Request, res: Response) {
//   if (service_is_healthy) {
//     res.send({ status: "OK" })
//   } else {
//     logger.error(`Service unhealthy`)
//     res.status(500).json({ status: "UNHEALTHY" })
//   }
// })

const secretPath = `/telegraf/bert/${bot.secretPathComponent()}`

// Set telegram webhook
// npm install -g localtunnel && lt --port 3000
// bot.telegram.setWebhook(`https://bert.ryancocks.net${secretPath}`)
// app.use(bot.webhookCallback(secretPath))

bot
  .launch({
    dropPendingUpdates: true,
    webhook: {
      hookPath: secretPath,
      domain: "bert.ryancocks.net", // required
      port: Number(process.env.PORT),
      cb: app, // Express integration,
      // tlsOptions: {}, // ... hmm, how do I force https? https is done by the ingress
    },
  })
  .catch((err) => logger.exception({}, err))

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
// app.listen(process.env.PORT, function () {
//   console.log("Telegram app listening on port 3000! (Note service/ingress port is different)")
// })

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
