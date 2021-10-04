'use strict';

import { URL } from "url";

const Logger = require("./faux_logger");
var logger = new Logger({ silent: false });

const fetch = require('node-fetch');
const Sentry = require("@sentry/node");


var prefix = "<prefix not set>: "
const curry_me = (send_message_function:any) => {
  return (_prefix:any) => {
    prefix = _prefix
    // console.log(`Set telegram prefix to "${prefix}"`)
    return send_message_function;
  }
}

export default curry_me

if (!process.env.TELEGRAM_KEY || ! process.env.TELEGRAM_CHAT_ID) {
  logger.error('Telegram message delivery not configured.');
  process.exit(1)
}


async function send_message_function(message:string) {
    logger.info(message);
    try {
      const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`);
      url.searchParams.append('chat_id', process.env.TELEGRAM_CHAT_ID as string);
      url.searchParams.append('text', `${prefix}${message}`);
      const response = await fetch(url);
      // const json = await response.json();
      // console.log(json);
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);
    }
  }

// Return a function that takes a sring prefix and returns the send_message(message) function
module.exports = curry_me(module.exports)
