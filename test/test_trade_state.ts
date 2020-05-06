import { expect } from 'chai'
import * as chai from 'chai'
const chaiBignumber = require("chai-bignumber");
chai.use(chaiBignumber());

import { TradeDefinition, TradeDefinitionInputSpec } from "../classes/specifications/trade_definition";

function base() {
  return { pair: "BTCUSDT", auto_size: true };
}

const Logger = require('../lib/faux_logger');
const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

describe("TradeState", function () {
  it("sets allowed to buy true if buy_price supplied")
  it("sets base_amount_imported from trade_definition")
});
