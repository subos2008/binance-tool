import * as bunyan from "bunyan"

import { Logger as LoggerInterface } from "../interfaces/logger"
export class Logger implements LoggerInterface {
  silent: boolean
  bunyan: bunyan
  constructor({ silent, template }: { silent: boolean; template?: object } = { silent: false, template: {} }) {
    if (!template) template = {}
    this.silent = silent
    let params = {
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
    this.bunyan = bunyan.createLogger({ ...params, ...template })
  }

  object(obj: any) {
    if (!this.silent) {
      // wouldn't this just have a string msg? Yes... it does seem to work in DataDog though
      this.bunyan.info(JSON.stringify(obj))
    }
  }
  info(obj: Object, ...params: any[]) {
    if (!this.silent) {
      this.bunyan.info(obj, ...params)
    }
  }
  notice(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.info(obj,...params)
    }
  }
  error(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.error(obj,...params)
    }
  }

  fatal(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.fatal(obj,...params)
    }
  }
  warn(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.warn(obj,...params)
    }
  }
  debug(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.debug(obj,...params)
    }
  }
  silly(obj: Object,...params: any[]) {
    if (!this.silent) {
      this.bunyan.debug(obj,...params)
    }
  }
}

module.exports = Logger
module.exports.Logger = Logger
