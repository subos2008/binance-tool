#!./node_modules/.bin/ts-node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */
const service_name = "telegram-bot-bert"

import * as Sentry from "@sentry/node"
Sentry.init({})
Sentry.configureScope(function (scope: any) {
  scope.setTag("service", service_name)
})

var service_is_healthy: boolean = true

import { Logger } from "../../interfaces/logger"
const LoggerClass = require("../../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: false })

import * as express from "express"
var app = express()
var bodyParser = require("body-parser")
const axios = require("axios")


app.use(bodyParser.json()) // for parsing application/json
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
) // for parsing application/x-www-form-urlencoded

app.get("/health", function (req, res) {
  if (service_is_healthy) {
    res.send({ status: "OK" })
  } else {
    logger.error(`Service unhealthy`)
    res.status(500).json({ status: "UNHEALTHY" })
  }
})

//This is the route the API will call
app.post("/new-message", function (req, res) {
  const { message } = req.body

  //Each message contains "text" and a "chat" object, which has an "id" which is the chat id

  if (!message || message.text.toLowerCase().indexOf("short") < 0) {
    // In case a message is not present, or if our message does not have the word marco in it, do nothing and return an empty response
    return res.end()
  }

  // If we've gotten this far, it means that we have received a message containing the word "marco".
  // Respond by hitting the telegram bot API and responding to the appropriate chat_id with the word "Polo!!"
  // Remember to use your own API toked instead of the one below  "https://api.telegram.org/bot<your_api_token>/sendMessage"
  axios
    .post("https://api.telegram.org/bot777845702:AAFdPS_taJ3pTecEFv2jXkmbQfeOqVZGER/sendMessage", {
      chat_id: message.chat.id,
      text: "OMG they are going short!!",
    })
    .then((response: any) => {
      // We get here if the message was successfully posted
      console.log("Message posted")
      res.end("ok")
    })
    .catch((err: any) => {
      // ...and here if it was not
      console.log("Error :", err)
      res.end("Error :" + err)
    })
})

// Finally, start our server
app.listen(3000, function () {
  console.log("Telegram app listening on port 3000!")
})
