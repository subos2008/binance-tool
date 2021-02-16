'use strict';

const Logger = require("./faux_logger");
var logger = new Logger({ silent: false });

const fetch = require('node-fetch');
const Sentry = require("@sentry/node");


var prefix = "<prefix not set>: "
const curry_me = (send_message_function) => {
  return (_prefix) => {
    prefix = _prefix
    // console.log(`Set telegram prefix to "${prefix}"`)
    return send_message_function;
  }
}

if (process.env.TELEGRAM_KEY && process.env.TELEGRAM_CHAT_ID) {
  module.exports = async function (message) {
    logger.info(message);
    try {
      const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`);
      url.searchParams.append('chat_id', process.env.TELEGRAM_CHAT_ID);
      url.searchParams.append('text', `${prefix}${message}`);
      const response = await fetch(url);
      // const json = await response.json();
      // console.log(json);
    } catch (error) {
      Sentry.captureException(error);
      logger.error(error);
    }
  };
} else {
  logger.warn('Telegram message delivery not configured.');

  module.exports = async function (message) {
    logger.info(message);
  };
}

// Return a function that takes a sring prefix and returns the send_message(message) function
module.exports = curry_me(module.exports)
