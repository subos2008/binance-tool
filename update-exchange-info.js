#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require('dotenv').config();

const Binance = require('binance-api-node').default;
const Logger = require('./lib/faux_logger');
const logger = new Logger({ silent: false });
var fs = require('fs');

const binance_client = Binance({
	apiKey: process.env.APIKEY,
	apiSecret: process.env.APISECRET
});

async function main() {
	try {
		exchange_info = await binance_client.exchangeInfo();
		var json = JSON.stringify(exchange_info);
		fs.writeFileSync('./test/exchange_info.json', json);
	} catch (error) {
		console.error('Error could not pull exchange info', error);
	}
}

main();
