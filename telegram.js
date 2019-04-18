'use strict';

if (process.env.TELEGRAM_KEY && process.env.TELEGRAM_CHAT_ID) {
	var TelegramBot = require('telegrambot');
	var api = new TelegramBot(process.env.TELEGRAM_KEY);

	module.exports = function(message) {
		console.log(message);
		api.invoke('sendMessage', { chat_id: process.env.TELEGRAM_CHAT_ID, text: `binance-oco: ${message}` }, function(
			err,
			result
		) {
			if (err) console.log(err);
			// console.log(result);
		});
	};
} else {
	console.log('Telegram message delivery not configured.');

	module.exports = function(message) {
		console.log(message);
	};
}
