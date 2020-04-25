import { Logger } from "../interfaces/logger";

module.exports = function(logger:Logger, prefix_string:string, e:Error) {
	if (logger) {
		const msg = `${prefix_string} ${ e }`;
		logger.error(msg);
  }
  throw e
};
