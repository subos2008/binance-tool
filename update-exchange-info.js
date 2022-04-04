#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

/* 
 * Utility to update the static copy of Binance's exchangeInfo object used by the tests.
 *
 * For developers only, users can ignore this file
 */

var fs = require('fs');

const Binance = require('binance-api-node').default;
const binance_client = Binance();

async function main() {
	try {
		exchange_info = await binance_client.exchangeInfo();
		var json = JSON.stringify(exchange_info);
		fs.writeFileSync('./test/exchange_info.json', json);
	} catch (err) {
		console.error('Error could not pull exchange info', error);
	}
}

main();
