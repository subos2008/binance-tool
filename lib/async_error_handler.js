const AsyncErrorWrapper = require('./async_error_wrapper');

module.exports = function(logger, prefix_string, e) {
	const wrapped_exception = new AsyncErrorWrapper(e);
	if (wrapped_exception.first_time_wrapped) {
		const msg = `${prefix_string} ${e.wrapped ? e : e.stack}`;
		logger.error(msg);
	}
	throw wrapped_exception;
};
