class FauxLogger {
  silent: boolean
  constructor({ silent }: { silent: boolean } = { silent: false }) {
    this.silent = silent;
  }

  info(args: string) {
    if (!this.silent) {
      console.log(args);
    }
  }
  error(args: string) {
    if (!this.silent) {
      console.log(args);
    }
  }
  warn(args: string) {
    if (!this.silent) {
      console.log(args);
    }
  }
  debug(args: string) {
    if (!this.silent) {
      if (process.env.LOG_LEVEL && process.env.LOG_LEVEL !== 'DEBUG') return
      console.log(args);
    }
  }
}

module.exports = FauxLogger;
