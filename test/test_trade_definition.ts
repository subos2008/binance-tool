import { expect } from 'chai'
import * as chai from 'chai'
const chaiBignumber = require("chai-bignumber");
chai.use(chaiBignumber());

import { TradeDefinition } from "../classes/specifications/trade_definition";

function base() {
  return { pair: "BTCUSDT", auto_size: true };
}

const Logger = require('../lib/faux_logger');
const null_logger = new Logger({ silent: true });

describe("TradeDefinition", function () {
  it("records soft_entry:true correctly", function () {
    const trade_definition = new TradeDefinition(null_logger,
      Object.assign({}, base(), { soft_entry: true, buy_price: "1" }), null
    );
    expect(trade_definition.soft_entry).to.be.true;
  });
  it("records soft_entry:false correctly", function () {
    const trade_definition = new TradeDefinition(null_logger,
      Object.assign({}, base(), { soft_entry: false }), null
    );
    expect(trade_definition.soft_entry).to.be.false;
  });
});
