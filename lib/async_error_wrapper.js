// We can't re-throw async exceptions as they become UnhandledPromiseRejections
// So let's wrap them inside here instead

// Ideal behaviour:
// - in the try/catch that first sees the error we log it and wrap it
// - as the exception passes up the chain it is done silently from that
//   point. i.e. when we see an already wrapped exception we pass it
//   up silently, assuming that it has already been printed once.
//   silently here might be interpreted as sans e.stack

// Suggested use:
// try {
//   await ...;
// } catch (e) {
//   const wrapped_exception = new AsyncErrorWrapper(e);
//   if (wrapped_exception.first_time_wrapped) {
//     const msg = `Exception during ... ${e} ${e.stack}`;
//     this.logger.error(msg);
//   }
//   throw wrapped_exception;
// }

class AsyncErrorWrapper extends Error {
	constructor(error) {
		super();
		// Error.captureStackTrace(this, this.constructor);
		this.actual_name = 'AsyncErrorWrapper';
		this.name = error.name;
		this.stack = error.stack;
		this.wrapped = true;
		// console.trace(
		// `Wrapping the following exception: ----${error.message}-----`
		// );
		if (error.actual_name === 'AsyncErrorWrapper') {
			// Input is an already wrapped exception
			this.message = error.message;
		} else {
			this.message = `[AsyncErrorWrapper of ${error.name}] ${error.message}`;
			this.original_message = error.message;
		}
	}
}

module.exports = AsyncErrorWrapper;
