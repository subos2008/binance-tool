var bunyan = require('bunyan');

class FauxLogger {
  silent: boolean
  bunyan: any
  constructor({ silent, template }: { silent: boolean, template: object } = { silent: false, template: {} }) {
    this.silent = silent;
    let args = {
      name: 'bunyan_stream_name',  // Required
      // level: <level name or number>,      // Optional, see "Levels" section
      streams: [
        {
          stream: process.stderr,
          level: "warn"
        },
        {
          stream: process.stdout,
          level: "debug"
        },
      ],
      // serializers: <serializers mapping>, // Optional, see "Serializers" section
      // src: <boolean>,                     // Optional, see "src" section

      // Any other fields are added to all log records as is.
      // foo: 'bar',
    }
    const foo = { ...args, ...template }
    console.log('logger setup:')
    console.log(foo)
    this.bunyan = bunyan.createLogger(foo);
  }

  info(...args: any[]) {
    if (!this.silent) {
      this.bunyan.info(...args);
    }
  }
  error(...args: any[]) {
    if (!this.silent) {
      this.bunyan.error(...args);
    }
  }
  warn(...args: any[]) {
    if (!this.silent) {
      this.bunyan.warn(...args);
    }
  }
  debug(...args: any[]) {
    if (!this.silent) {
      this.bunyan.debug(...args);
    }
  }
}

module.exports = FauxLogger;
