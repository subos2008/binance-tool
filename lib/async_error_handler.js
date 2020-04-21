module.exports = function(logger, prefix_string, e) {
	if (logger) {
		const msg = `${prefix_string} ${e.wrapped ? e : e.stack}`;
		logger.error(msg);
	}
};
