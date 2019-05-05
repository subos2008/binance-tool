class FauxLogger {
	constructor({ silent } = {}) {
		this.silent = silent;
	}

	info(args) {
		if (!this.silent) {
			console.log(args);
		}
	}
	error(args) {
		if (!this.silent) {
			console.log(args);
		}
	}
	warn(args) {
		if (!this.silent) {
			console.log(args);
		}
	}
	debug(args) {
		if (!this.silent) {
			console.log(args);
		}
	}
}

module.exports = FauxLogger;
