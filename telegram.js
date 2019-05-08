'use strict';

const fetch = require('node-fetch');
const url = require('url');

const getURL = async (url) => {
	try {
		const response = await fetch(url);
		const json = await response.json();
		console.log(json);
	} catch (error) {
		console.log(error);
	}
};

if (process.env.TELEGRAM_KEY && process.env.TELEGRAM_CHAT_ID) {
	module.exports = async function(message) {
		console.log(message);
		try {
			const url = new URL(`https://api.telegram.org/bot${process.env.TELEGRAM_KEY}/sendMessage`);
			url.searchParams.append('chat_id', process.env.TELEGRAM_CHAT_ID);
			url.searchParams.append('text', `binance-oco: ${message}`);
			const response = await fetch(url);
			// const json = await response.json();
			// console.log(json);
		} catch (e) {
			console.log(e);
		}
	};
} else {
	console.log('Telegram message delivery not configured.');

	module.exports = async function(message) {
		console.log(message);
	};
}
