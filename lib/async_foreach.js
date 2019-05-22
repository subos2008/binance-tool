const async_error_handler = require('./async_error_handler');

module.exports = async function asyncForEach(logger, array, callback) {
	for (let index = 0; index < array.length; index++) {
		try {
			await callback(array[index], index, array);
		} catch (e) {
			async_error_handler(logger, 'asyncForEach: Exception *********', e);
		}
	}
};
