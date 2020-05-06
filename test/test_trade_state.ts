/// <reference types="../chai-bignumber" />

import { expect } from 'chai'
import * as chai from 'chai'
const chaiBignumber = require("chai-bignumber");
chai.use(chaiBignumber());

import { TradeDefinition, TradeDefinitionInputSpec } from "../classes/specifications/trade_definition";
import { create_new_trade, build_trade_state_for_trade_id, TradeState } from "../classes/persistent_state/redis_trade_state";
import { Logger } from '../interfaces/logger';

function base() {
  return { pair: "BTCUSDT", auto_size: true };
}

const Logger = require('../lib/faux_logger');
const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

var redis = require("redis-mock").createClient();
beforeEach(function () {
  // empty
});

afterEach(function (done) {
  redis.flushall();
  redis.quit(done);
});

describe("TradeState", function () {
  async function setup(overrides: { td_config?: any, logger?: Logger } = {}) {
    const logger : Logger = overrides.logger ? overrides.logger : null_logger
    const trade_definition_input_spec: TradeDefinitionInputSpec = Object.assign({
      pair: "BTCUSDT",
      soft_entry: true,
      auto_size: true,
    }, overrides.td_config || {});

    const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
    const trade_id = await create_new_trade({ logger, redis, trade_definition })
    const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger });

    return { trade_id, trade_definition, trade_state }
  }
  describe("create_new_trade", function () {
    describe("determines and sets allowed to buy", function () {
      it("true if buy_price supplied", async function () {
        let { trade_state } = await setup({ td_config: { buy_price: "1" } })
        expect(await trade_state.get_buying_allowed()).to.be.true
      })
      it("false if buy_price undefined", async function () {
        let { trade_state } = await setup({ td_config: { stop_price: "1", soft_entry: false }, })
        expect(await trade_state.get_buying_allowed()).to.be.false
      })
    })
    it("sets base_amount_imported from trade_definition", async function () {
      let { trade_state } = await setup({ td_config: { base_amount_imported: "100", buy_price: "1", target_price: "10" } })
      expect(await trade_state.get_base_amount_held()).to.bignumber.equal("100")
    });
  });
});
