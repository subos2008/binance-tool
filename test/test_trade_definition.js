"use strict";
const chai = require("chai");
chai.use(require("chai-bignumber")());
const expect = chai.expect;

const {TradeDefinition} = require("../classes/specifications/trade_definition");

function base() {
  return { pair: "BTCUSDT" };
}

describe("TradeDefinition", function() {
  it("records soft_entry:true correctly", function() {
    const trade_definition = new TradeDefinition(
      Object.assign({}, base(), { soft_entry: true })
    );
    expect(trade_definition.soft_entry).to.be.true;
  });
  it("records soft_entry:false correctly", function() {
    const trade_definition = new TradeDefinition(
      Object.assign({}, base(), { soft_entry: false })
    );
    expect(trade_definition.soft_entry).to.be.false;
  });
});
