var bunyan = require("bunyan")

import { Logger as LoggerInterface } from "../interfaces/logger"
export class Logger implements LoggerInterface {
  silent: boolean
  bunyan: any
  constructor({ silent, template }: { silent: boolean; template?: object } = { silent: false, template: {} }) {
    if (!template) template = {}
    this.silent = silent
    let args = {
      name: "bunyan_stream_name", // Required
      // level: <level name or number>,      // Optional, see "Levels" section
      // streams: [
      //   {
      //     stream: process.stderr,
      //     level: "warn",
      //   },
      //   {
      //     stream: process.stdout,
      //     level: "info",
      //   },
      // ],
      // src: true, // slow, not for production
      // serializers: bunyan.stdSerializers,
      // serializers: <serializers mapping>, // Optional, see "Serializers" section
      // src: <boolean>,                     // Optional, see "src" section

      // Any other fields are added to all log records as is.
      // foo: 'bar',
    }
    this.bunyan = bunyan.createLogger({ ...args, ...template })
  }

  object(obj: any) {
    if (!this.silent) {
      this.bunyan.info(JSON.stringify(obj))
    }
  }
  info(...args: any[]) {
    if (!this.silent) {
      this.bunyan.info(...args)
    }
  }
  notice(...args: any[]) {
    if (!this.silent) {
      this.bunyan.info(...args)
    }
  }
  error(...args: any[]) {
    if (!this.silent) {
      this.bunyan.error(...args)
    }
  }
  fatal(...args: any[]) {
    if (!this.silent) {
      this.bunyan.fatal(...args)
    }
  }
  warn(...args: any[]) {
    if (!this.silent) {
      this.bunyan.warn(...args)
    }
  }
  debug(...args: any[]) {
    if (!this.silent) {
      this.bunyan.debug(...args)
    }
  }
  silly(...args: any[]) {
    if (!this.silent) {
      this.bunyan.debug(...args)
    }
  }
}

module.exports = Logger
module.exports.Logger = Logger
