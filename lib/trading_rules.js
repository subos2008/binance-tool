const assert = require('assert');
const BigNumber = require('bignumber.js');

BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

class TradingRules {
	constructor({ max_allowed_portfolio_loss_percentage_per_trade, allowed_to_trade_without_stop } = {}) {
		assert(max_allowed_portfolio_loss_percentage_per_trade);
		assert(BigNumber.isBigNumber(max_allowed_portfolio_loss_percentage_per_trade));
		this.max_allowed_portfolio_loss_percentage_per_trade = max_allowed_portfolio_loss_percentage_per_trade;

		// convert falsy to false
		this.allowed_to_trade_without_stop = allowed_to_trade_without_stop ? true : false;
	}
}

module.exports = TradingRules;
