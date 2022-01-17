#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
const service_name = "telegram-bot-bert"

// require("dotenv").config()

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

var service_is_healthy: boolean = true

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import express, { Request, Response } from "express"
import { Telegraf } from "telegraf"
import { Commands } from "./commands"

const token = process.env.TELEGRAM_KEY
if (token === undefined) {
  throw new Error("TELEGRAM_KEY must be provided!")
}

const TAS_URL = process.env.TRADE_ABSTRACTION_SERVICE_URL
if (TAS_URL === undefined) {
  throw new Error("TRADE_ABSTRACTION_SERVICE_URL must be provided!")
}

var app = express()
var bodyParser = require("body-parser")

app.use(bodyParser.json()) // for parsing application/json
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
) // for parsing application/x-www-form-urlencoded

app.get("/health", function (req: Request, res: Response) {
  if (service_is_healthy) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})

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
bot.catch((error) => {
  Sentry.captureException(error)
  logger.error(error)
})

// Register logger middleware
bot.use((ctx, next) => {
  const start = Date.now()
  return next().then(() => {
    const ms = Date.now() - start
    console.log("response time %sms", ms)
  })
})

const secretPath = `/telegraf/bert/${bot.secretPathComponent()}`

// Set telegram webhook
// npm install -g localtunnel && lt --port 3000
bot.telegram.setWebhook(`https://bert.ryancocks.net${secretPath}`)
app.use(bot.webhookCallback(secretPath))

// Finally, start our server
// $  npm install -g localtunnel && lt --port 3000
app.listen(3000, function () {
  console.log("Telegram app listening on port 3000!")
})

process.once("SIGINT", () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
