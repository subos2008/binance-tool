"use strict";
const chai = require("chai");
chai.use(require("chai-bignumber")());
const expect = chai.expect;

const BigNumber = require("bignumber.js");

const TradeDefinition = require("../classes/trade_definition");
const Logger = require("../lib/faux_logger");
const TradeStateMachine = require("../classes/redis_trade_state_machine");

const logger = new Logger({ silent: false });
const null_logger = new Logger({ silent: true });

let message_queue = [];
function fresh_message_queue() {
  message_queue = [];
  return msg => {
    message_queue.push(msg);
  };
}

function most_recent_message() {
  return message_queue[message_queue.length - 1];
}

var redis;
beforeEach(function() {
  redis = require("redis-mock").createClient();
});

afterEach(function(done) {
  redis.flushall();
  redis.quit(done);
});

describe("TradeStateMachine", function() {
  //   Working on determining current trade state from
  //   redis trade:x::completed, trade:x:position:target and
  //   trade:x:position::actual values.

  //   Doing pretty well except there's currently no way
  //   to determine when draining if we are draining at target
  //   or stop.

  //   ... could work on definine the exact behaviour at target
  //   and stop at this point.

  describe("On startup (pre-price tick)", () => {
    // states: [untriggered, filling, filled, draining, complete]

    // state: completed
    describe("when trade:x:completed is true", () => {
      describe("current trade signal", () => {
        it("is set to :completed");
      });
      describe("assertions", () => {
        it("target is 0 or null");
        it("actual is 0 or null");
      });
    });

    describe("trade:x:completed is false", () => {
      // state: untriggered
      describe("trade:x:position:target ...", () => {
        describe("... is null", () => {
          describe("current trade signal", () => {
            it("is set to :untriggered");
          });
          describe("assertions", () => {
            it("actual is null");
          });
        });

        // state: filling, filled
        describe("... is greater than zero", () => {
          describe("current trade signal", () => {
            it("is set to :fill");
          });
          describe("trade:x:position:actual ...", () => {
            describe("... is ~= target", () => {
              it("has state :filled");
              // could remove target here so `actual` without `target` means :filled
            });
            describe("is null, zero, or between zero and target", () => {
              it("has state :filling");
              it("maybe creates the buy order if actual is null"); // if actual is null on restart we possibly crashed creating the order
            });
          });
        });

        // state: draining
        describe("... is zero", () => {
          describe("assertions", () => {
            it("actual is not null");
          });
          describe("current trade signal", () => {
            it("is set to :drain"); // drain_stop or drain_target? Difference in the order types used
          });
          describe("trade:x:position:actual ...", () => {
            describe("... is ~= zero", () => {
              it("has state :complete");
              it("removes trade:x:position:*");
              it("sets trade:x:complete to true");
            });
            describe("... is > zero", () => {
              it("has state :draining");
              it("checks if the sell order is created"); // stop or target style sell orders?
            });
          });
        });
      });
    });
  });

  describe("On price tick", () => {});
});
