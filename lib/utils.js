const assert = require('assert');
const BigNumber = require('bignumber.js');

// TODO: binance_regex only supports BTC and returns undef otherwise
const binance_regex = /^([A-Z]+)(BTC)$/;
const ccxt_regex = /^([A-Z]+)\/([A-Z]+)$/;

function base_currency_for_binance_pair(pair) {
	const [ total, base_coin, quote_coin ] = pair.match(binance_regex);
	assert(base_coin);
	return base_coin;
}

function base_currency_for_ccxt_pair(pair) {
	const [ total, base_coin, quote_coin ] = pair.match(ccxt_regex);
	assert(base_coin);
	return base_coin;
}

function quote_currency_for_binance_pair(pair) {
	const [ total, base_coin, quote_coin ] = pair.match(binance_regex);
	assert(quote_coin);
	return quote_coin;
}

function convert_binance_pair_to_ccxt_pair(binance_pair) {
	return `${base_currency_for_binance_pair(binance_pair)}/${quote_currency_for_binance_pair(binance_pair)}`;
}

// The amount of quote coin that can be bought, so rounds down
// TODO: decimal places is a hardcoded constant
function quote_volume_at_price_to_base_volume({ quote_volume, price } = {}) {
	assert(BigNumber.isBigNumber(quote_volume));
	assert(BigNumber.isBigNumber(price));
	return quote_volume.dividedBy(price).dp(8, BigNumber.ROUND_DOWN);
}

// TODO: rounding
function base_volume_at_price_to_quote_volume({ base_volume, price } = {}) {
	assert(BigNumber.isBigNumber(base_volume));
	assert(BigNumber.isBigNumber(price));
	return base_volume.multipliedBy(price);
}

function roundStep(qty, stepSize) {
	// Integers do not require rounding
	if (Number.isInteger(qty)) return qty;
	const qtyString = qty.toFixed(16);
	const desiredDecimals = Math.max(stepSize.indexOf('1') - 1, 0);
	const decimalIndex = qtyString.indexOf('.');
	return BigNumber(qtyString.slice(0, decimalIndex + desiredDecimals + 1));
}

function roundTicks(price, tickSize) {
	const formatter = new Intl.NumberFormat('en-US', {
		style: 'decimal',
		minimumFractionDigits: 0,
		maximumFractionDigits: 8
	});
	const precision = formatter.format(tickSize).split('.')[1].length || 0;
	if (typeof price === 'string') price = BigNumber(price);
	return price.toFixed(precision);
}

module.exports = {
	base_currency_for_binance_pair,
	quote_currency_for_binance_pair,
	convert_binance_pair_to_ccxt_pair,
	base_currency_for_ccxt_pair,
	quote_volume_at_price_to_base_volume,
	base_volume_at_price_to_quote_volume,
	roundTicks,
	roundStep
};
