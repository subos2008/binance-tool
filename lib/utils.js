const assert = require('assert');
const BigNumber = require('bignumber.js');

// TODO: binance_regex only supports BTC and returns undef otherwise
const binance_regex = /^([A-Z]+)(BTC|USDT|BNB)$/;
const ccxt_regex = /^([A-Z]+)\/([A-Z]+)$/;

function break_up_binance_pair(pair) {
	try {
		assert(typeof pair === 'string');
		const [ total, base_coin, quote_coin ] = pair.match(binance_regex);
		return [ total, base_coin, quote_coin ];
	} catch (e) {
		let msg = `Cannot split up binance pair: ${pair}, check utils knows this quote currency`;
		console.error(msg);
		throw new Error(msg);
	}
}

function base_currency_for_binance_pair(pair) {
	const [ total, base_coin, quote_coin ] = break_up_binance_pair(pair);
	assert(base_coin);
	return base_coin;
}

function quote_currency_for_binance_pair(pair) {
	const [ total, base_coin, quote_coin ] = break_up_binance_pair(pair);
	assert(quote_coin);
	return quote_coin;
}

function base_currency_for_ccxt_pair(pair) {
	assert(base_coin);
	return base_coin;
}

function convert_binance_pair_to_ccxt_pair(binance_pair) {
	return `${base_currency_for_binance_pair(binance_pair)}/${quote_currency_for_binance_pair(binance_pair)}`;
}

// The amount of quote coin that can be bought, so rounds down
// TODO: decimal places is a hardcoded constant
function quote_volume_at_price_to_base_volume({ quote_volume, price } = {}) {
	assert(quote_volume);
	assert(price);
	assert(BigNumber.isBigNumber(quote_volume));
	assert(BigNumber.isBigNumber(price), `Expected price (${price}) to be a BigNumber`);
	return quote_volume.dividedBy(price).dp(8, BigNumber.ROUND_DOWN);
}

// TODO: rounding
function base_volume_at_price_to_quote_volume({ base_volume, price } = {}) {
	assert(BigNumber.isBigNumber(base_volume));
	assert(BigNumber.isBigNumber(price));
	return base_volume.multipliedBy(price);
}

// Binance
function roundStep(qty, stepSize) {
	// Integers do not require rounding
	if (Number.isInteger(qty)) return qty;
	const qtyString = qty.toFixed(16);
	const desiredDecimals = Math.max(stepSize.indexOf('1') - 1, 0);
	const decimalIndex = qtyString.indexOf('.');
	return BigNumber(qtyString.slice(0, decimalIndex + desiredDecimals + 1));
}

// Binance
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

// Binance
function _get_symbol_filters({ exchange_info, symbol } = {}) {
	// TODO: argh omg this is disgusting hardcoding of the default_pair
	let symbol_data = exchange_info.symbols.find((ei) => ei.symbol === symbol);
	if (!symbol_data) {
		// TODO: some kind of UnrecognisedPairError class?
		throw new Error(`Could not find exchange info for ${symbol}`);
	}
	return symbol_data.filters;
}

// Binance
function munge_and_check_quantity({ exchange_info, symbol, volume } = {}) {
	assert(typeof volume !== 'undefined');
	assert(exchange_info);
	assert(symbol);
	let filters = _get_symbol_filters({ exchange_info, symbol });
	const { stepSize, minQty } = filters.find((eis) => eis.filterType === 'LOT_SIZE');
	volume = BigNumber(roundStep(BigNumber(volume), stepSize));
	if (volume.isLessThan(minQty)) {
		throw new Error(`${volume} does not meet minimum quantity (LOT_SIZE): ${minQty}.`);
	}
	return volume;
}

// Binance
function munge_and_check_price({ exchange_info, symbol, price } = {}) {
	assert(typeof price !== 'undefined');
	assert(exchange_info);
	assert(symbol);
	price = BigNumber(price);
	if (price.isZero()) {
		return price; // don't munge zero, special case for market buys
	}
	let filters = _get_symbol_filters({ exchange_info, symbol });
	const { tickSize, minPrice } = filters.find((eis) => eis.filterType === 'PRICE_FILTER');
	price = BigNumber(roundTicks(price, tickSize));
	if (price.isLessThan(minPrice)) {
		throw new Error(`${price} does not meet minimum order price (PRICE_FILTER): ${minPrice}.`);
	}
	return price;
}

// Binance
function check_notional({ price, volume, exchange_info, symbol } = {}) {
	assert(typeof volume !== 'undefined');
	assert(typeof price !== 'undefined');
	assert(exchange_info);
	assert(symbol);
	price = BigNumber(price);
	if (price.isZero()) {
		return price; // don't munge zero, special case for market buys
	}
	let filters = _get_symbol_filters({ exchange_info, symbol });
	const { minNotional } = filters.find((eis) => eis.filterType === 'MIN_NOTIONAL');
	let quote_volume = price.times(volume);
	if (quote_volume.isLessThan(minNotional)) {
		throw new Error(
			`does not meet minimum order value ${minNotional} (MIN_NOTIONAL) (Buy of ${volume} at ${price} = ${quote_volume}).`
		);
	}
}

module.exports = {
	base_currency_for_binance_pair,
	quote_currency_for_binance_pair,
	convert_binance_pair_to_ccxt_pair,
	base_currency_for_ccxt_pair,
	quote_volume_at_price_to_base_volume,
	base_volume_at_price_to_quote_volume,
	roundTicks,
	roundStep,
	munge_and_check_quantity,
	munge_and_check_price,
	check_notional,
	break_up_binance_pair
};
