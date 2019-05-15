#!/usr/bin/env node
/* eslint-disable no-console */
/* eslint func-names: ["warn", "as-needed"] */

require('dotenv').config();

// TODO: convert all the process.exit calls to be exceptions
// TODO: add watchdog on trades stream - it can stop responding without realising
// TODO: - in the original implementations

const Binance = require('binance-api-node').default;
const send_message = require('./telegram.js');
const Algo = require('./service_lib/algo-virtual');
const Logger = require('./lib/faux_logger');
const BigNumber = require('bignumber.js');

const logger = new Logger({ silent: false });

const trading_rules = {
	max_allowed_portfolio_loss_percentage_per_trade: BigNumber(1)
};

const { argv } = require('yargs')
	.usage('Usage: $0')
	.example(
		'$0 -p BNBBTC -a 1 -b 0.002 -s 0.001 -t 0.003',
		'Place a buy order for 1 BNB @ 0.002 BTC. Once filled, place a stop-limit sell @ 0.001 BTC. If a price of 0.003 BTC is reached, cancel stop-limit order and place a limit sell @ 0.003 BTC.'
	)
	// '-p <tradingPair>'
	.demand('pair')
	.alias('p', 'pair')
	.describe('p', 'Set trading pair eg. BNBBTC')
	// '-i <intermediateCurrency>'
	.demand('intermediateCurrency')
	.alias('i', 'intermediateCurrency')
	.describe('i', 'Set intermediateCurrency eg. BTC when trading a virtual pair')
	// '-a <amount>'
	.string('a')
	.alias('a', 'amount')
	.describe('a', 'Set amount to buy/sell')
	// '-q <amount in quote coin>'
	.string('q')
	.alias('q', 'amountquote')
	.describe('q', 'Set amount to buy in quote coin (alternative to -a for limit buy orders only)')
	// '-b <buyPrice>'
	.string('b')
	.alias('b', 'buy')
	.alias('b', 'e')
	.alias('b', 'entry')
	.describe('b', 'Set buy price (0 for market buy)')
	// '-s <stopPrice>'
	.string('s')
	.alias('s', 'stop')
	.describe('s', 'Set stop-limit order stop price')
	// '-l <limitPrice>'
	.string('l')
	.alias('l', 'limit')
	.describe('l', 'Set sell stop-limit order limit price (if different from stop price)')
	// '-t <targetPrice>'
	.string('t')
	.alias('t', 'target')
	.describe('t', 'Set target limit order sell price')
	// '--soft-entry'
	.boolean('soft-entry')
	.describe('soft-entry', 'Wait until the buy price is hit before creating the limit buy order')
	.default('soft-entry', false)
	// '--auto-size'
	.boolean('auto-size')
	.describe('auto-size', 'Automatically size the trade based on stopLoss % and available funds')
	.default('auto-size', false)
	// '--percentages'
	.boolean('percentages')
	.describe('percentages', 'Print trade stats and exit')
	.default('percentages', false)
	// '--non-bnb-fees'
	.boolean('F')
	.alias('F', 'non-bnb-fees')
	.describe('F', 'Calculate stop/target sell amounts assuming not paying fees using BNB')
	.default('F', false);

let {
	p: pair,
	i: intermediateCurrency,
	a: amount,
	q: quoteAmount,
	b: buyPrice,
	s: stopPrice,
	l: limitPrice,
	t: targetPrice,
	F: nonBnbFees,
	'soft-entry': soft_entry,
	'auto-size': auto_size,
	percentages: percentages
} = argv;

if (this.buyPrice === '') {
	this.buyPrice = '0';
}

const binance_client = Binance({
	apiKey: process.env.APIKEY,
	apiSecret: process.env.APISECRET
	// getTime: xxx // time generator function, optional, defaults to () => Date.now()
});

const algo = new Algo({
	ee: binance_client,
	send_message,
	logger,
	virtualPair: pair,
	intermediateCurrency,
	amount,
	quoteAmount,
	buyPrice,
	stopPrice,
	limitPrice,
	targetPrice,
	nonBnbFees,
	soft_entry,
	trading_rules,
	auto_size,
	percentages,
	slippage_percent: BigNumber('1')
});

const execSync = require('child_process').execSync;
code = execSync('date -u >&2');

algo
	.main()
	.then(() => {
		console.log('main loop complete');
	})
	.catch((error) => {
		if (error.name && error.name === 'FetchError') {
			logger.error(`${error.name}: Likely unable to connect to Binance and/or Telegram: ${error}`);
		} else {
			logger.error(`Error in main loop: ${error}`);
			logger.error(error);
			logger.error(`Error in main loop: ${error.stack}`);
			send_message(`${pair}: Error in main loop: ${error}`);
		}
		soft_exit();
	});

function dump_keepalive() {
	let handles = process._getActiveHandles();
	console.log('Handles:');
	console.log(handles.filter((handle) => handle._isStdio != true));
	let requests = process._getActiveRequests();
	console.log('Requests:');
	console.log(requests);
	// setTimeout(dump_keepalive, 10000);
}

// Note this method returns!
// Shuts down everything that's keeping us alive so we exit
function soft_exit(exit_code) {
	algo.shutdown_streams();
	if (exit_code) process.exitCode = exit_code;
	// setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
}

process.on('exit', () => {
	algo.shutdown_streams();
});
