/// <reference types="../chai-bignumber" />

import { expect } from "chai"
import * as chai from "chai"
const chaiBignumber = require("chai-bignumber")
chai.use(chaiBignumber())

import { Edge58EntrySignals } from "../classes/edges/edge58/edge58"
import { Edge58EntrySignalsCallbacks } from "../classes/edges/edge58/interfaces"

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const null_logger = new LoggerClass({ silent: true })

var redis = require("redis-mock").createClient()
beforeEach(function () {
  // empty
})

afterEach(function (done) {
  redis.flushall()
  redis.quit(done)
})

let symbol = "BTCUSDT"
let exchange = "tests"
let market_identifier: MarketIdentifier_V2 = {
  version: "v2",
  exchange_identifier: { version: "v2", exchange },
  symbol,
}

let default_parameters: Edge58Parameters_V1 = {
  version: "v1",
  candle_timeframe: "1w",
  candles_of_price_history: 2,
  stops: {
    wick_definitions_percentages_of_body: {
      "minimal_wick_less_than": "5",
      "large_wick_greater_than": "10",
    },
    stop_percentages: {
      "minimal_wick": "4",
      "default": "6",
      "large_wick": "12",
    },
  },
  entry_filters: {
    candle_body_percentage_considered_too_large: "35",
    adx_parameters: {
      adx_period: 14,
      limadx: 14,
    },
  },
}

import * as candles from "./candles/BTCUSDT-2017-12-20"
import { Edge58Parameters_V1 } from "../events/shared/edge58"
import { Edge56EntrySignalsCallbacks } from "../classes/edges/edge56"
import { MarketIdentifier_V2 } from "../events/shared/market-identifier"

let closeTime = 1000
function build_candle(open: number, high: number, low: number, close: number) {
  closeTime = closeTime + 1000 * 60 * 60 * 24 * 7
  return { open: open.toString(), close: close.toString(), low: low.toString(), high: high.toString(), closeTime }
}

describe("BTC2018 Trace", function () {
  async function setup(overrides: { td_config?: any; logger?: Logger } = {}) {
    const logger: Logger = overrides.logger ? overrides.logger : null_logger
    // const trade_definition_input_spec: TradeDefinitionInputSpec = Object.assign(
    //   {
    //     pair: "BTCUSDT",
    //     soft_entry: true,
    //     auto_size: true,
    //   },
    //   overrides.td_config || {}
    // )

    // const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
    // const trade_id = await create_new_trade({ logger, redis, trade_definition })
    // const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger })

    return {}
  }
  it.skip("publishes an event to AMQP on entry signal", async function () {})
})

describe("Edge58Service", function () {
  it.skip("publishes an event to AMQP on entry signal", async function () {})
})

describe("Edge58EntrySignals", function () {
  async function setup(overrides: { td_config?: any; logger?: Logger } = {}) {
    const logger: Logger = overrides.logger ? overrides.logger : null_logger
    // const trade_definition_input_spec: TradeDefinitionInputSpec = Object.assign(
    //   {
    //     pair: "BTCUSDT",
    //     soft_entry: true,
    //     auto_size: true,
    //   },
    //   overrides.td_config || {}
    // )

    // const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
    // const trade_id = await create_new_trade({ logger, redis, trade_definition })
    // const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger })

    return {}
  }

  describe("Stop Percentages", function () {
    function setup(overrides: { td_config?: any; logger?: Logger } = {}) {
      const logger: Logger = overrides.logger ? overrides.logger : null_logger
      let symbol = "TESTUSDT"
      let callbacks = new (class Mock implements Edge58EntrySignalsCallbacks {
        enter_or_add_to_position(args: any): void {}
      })()
      let edge58_parameters = Object.assign({}, default_parameters, {
        stops: {
          wick_definitions_percentages_of_body: {
            "minimal_wick_less_than": "5",
            "large_wick_greater_than": "10",
          },
          stop_percentages: {
            "minimal_wick": "4",
            "default": "6",
            "large_wick": "12",
          },
        },
      })
      let edge = new Edge58EntrySignals({
        logger,
        initial_candles: [],
        symbol,
        callbacks,
        edge58_parameters,
        market_identifier,
      })
      return { logger, symbol, callbacks, edge58_parameters, edge }
    }

    describe("Long", function () {
      const direction = "long"
      it("returns correct amount with no wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(100, 200, 100, 200), direction)).to.bignumber.equal("4")
      })
      it("returns correct amount with minimal wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(100, 200, 99, 200), direction), "upper").to.bignumber.equal(
          "4"
        )
        expect(edge.get_stop_percentage(build_candle(100, 200, 96, 200), direction), "lower").to.bignumber.equal(
          "4"
        )
      })
      it("returns correct amount with large wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(100, 200, 89, 200), direction)).to.bignumber.equal("12")
        expect(edge.get_stop_percentage(build_candle(100, 200, 50, 200), direction)).to.bignumber.equal("12")
      })
      it("returns correct amount with middle wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(100, 200, 91, 200), direction)).to.bignumber.equal("6")
        expect(edge.get_stop_percentage(build_candle(100, 200, 94, 200), direction)).to.bignumber.equal("6")
      })
    })

    describe("Short", function () {
      const direction = "short"
      it("returns correct amount with no wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(200, 200, 110, 100), direction)).to.bignumber.equal("4")
      })
      it("returns correct amount with minimal wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(200, 201, 100, 100), direction)).to.bignumber.equal("4")
        expect(edge.get_stop_percentage(build_candle(200, 204, 100, 100), direction)).to.bignumber.equal("4")
      })
      it("returns correct amount with large wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(200, 211, 100, 100), direction), "first").to.bignumber.equal(
          "12"
        )
        expect(edge.get_stop_percentage(build_candle(200, 299, 100, 100), direction), "second").to.bignumber.equal(
          "12"
        )
      })
      it("returns correct amount with middle wick", async function () {
        let { edge } = setup()
        expect(edge.get_stop_percentage(build_candle(200, 209, 100, 100), direction)).to.bignumber.equal("6")
        expect(edge.get_stop_percentage(build_candle(200, 205, 100, 100), direction)).to.bignumber.equal("6")
      })
    })
  })

  /**
   * First - protect basic send_message signals as these are now used for price range break signals
   * for our manual weekly entries
   */

  describe("Short entries", function () {
    it.skip("not triggered by equality", async function () {})
    it.skip("not prevented by too-old candle", async function () {})
    it.skip("err, does lowest from history use open and close? maybe have body or wicks as an input?", async function () {})
    it.skip("uses Sunday as the weekly close day - matching TV, not Binance", async function () {})
  })

  it.skip("triggers long", async function () {})
  it.skip("calls enter_position when triggered long", async function () {})
  it.skip("calls enter_position when triggered short", async function () {})
  it.skip("considers the correct number of weeks of history", async function () {})
  it.skip("send_message if exception occurs while setting the stop", async function () {})

  describe("Large candle body detection", function () {
    it.skip("works for longs", async function () {})
    it.skip("works for shorts", async function () {})
  })

  describe("Known Issues", function () {
    it.skip("stops: body size of 0 for candle results in div by 0", async function () {})
  })
})

describe("Edge58", function () {
  async function setup(overrides: { td_config?: any; logger?: Logger } = {}) {
    const logger: Logger = overrides.logger ? overrides.logger : null_logger
    // const trade_definition_input_spec: TradeDefinitionInputSpec = Object.assign(
    //   {
    //     pair: "BTCUSDT",
    //     soft_entry: true,
    //     auto_size: true,
    //   },
    //   overrides.td_config || {}
    // )

    // const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
    // const trade_id = await create_new_trade({ logger, redis, trade_definition })
    // const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger })

    return {}
  }

  it.skip("Enters position", async function () {})
  it.skip("Adds to position", async function () {})
  it.skip("Moves stop", async function () {})
  describe("Short entries", function () {
    it.skip("not triggered by equality", async function () {})
    it.skip("not prevented by too-old candle", async function () {})
    it.skip("err, does lowest from history use open and close? maybe have body or wicks as an input?", async function () {})
  })
  it.skip("triggers long", async function () {})
  it.skip("calls enter_position when triggered long", async function () {})
  it.skip("calls enter_position when triggered short", async function () {})
  it.skip("considers the correct number of weeks of history", async function () {})

  describe("Entry/Add Signals", function () {
    it.skip("examines the correct number of candles of history", async function () {})
    it.skip("examines the correct number of candles of history - with/without initial candles", async function () {})
  })

  describe("Position Management", function () {
    describe("When not in position", function () {
      it.skip("Enters position", async function () {})
      it.skip("Sets stop on full position", async function () {})
      it.skip("What do we do about avoiding leverage and only entering if we have funds available?", async function () {})
    })
    describe("When in position", function () {
      it.skip("Adds to position", async function () {})
      it.skip("Cancels existing stop on position", async function () {})
      it.skip("Sets stop on full position", async function () {})
      it.skip("What do we do about avoiding leverage and only adding if we have funds available?", async function () {})
    })
  })

  describe("Position Entry", function () {
    it.skip("What do we do if we get an entry signal short when we are long and visa versa?", async function () {})
    it.skip("Doesn't signal entry until it has the required number of weeks of history", async function () {})

    describe("Entry Filters", function () {
      it.skip("Avoids entering position when ADX doesn't match", async function () {})
      it.skip("Avoids entering position on large candles", async function () {})
    })

    describe("Sucessfull Operation", function () {
      it.skip("Market enters with the correct position size", async function () {})
      it.skip("Doesn't enter if a full position size is not available", async function () {})

      describe("Stop Management", function () {
        it.skip("Sets stop correctly for a candle with no wick", async function () {})
        it.skip("Sets stop correctly for a candle with a small wick", async function () {})
        it.skip("Sets stop correctly for a candle with a large wick", async function () {})
      })
    })
  })

  describe("Adding to Position", function () {
    it.skip("Adds to position", async function () {})
    it.skip("Adds to position, even when ADX doesn't match", async function () {})
    describe("Stop Management", function () {
      it.skip("Cancels the previous stop", async function () {})
      it.skip("Creates a new stop for the full position size", async function () {})
      it.skip("Sets stop correctly for a candle with no wick", async function () {})
      it.skip("Sets stop correctly for a candle with a small wick", async function () {})
      it.skip("Sets stop correctly for a candle with a large wick", async function () {})
    })
  })
})

// describe("TradeState", function () {
//   async function setup(overrides: { td_config?: any; logger?: Logger } = {}) {
//     const logger: Logger = overrides.logger ? overrides.logger : null_logger
//     const trade_definition_input_spec: TradeDefinitionInputSpec = Object.assign(
//       {
//         pair: "BTCUSDT",
//         soft_entry: true,
//         auto_size: true,
//       },
//       overrides.td_config || {}
//     )

//     const trade_definition = new TradeDefinition(logger, trade_definition_input_spec)
//     const trade_id = await create_new_trade({ logger, redis, trade_definition })
//     const trade_state = await build_trade_state_for_trade_id({ trade_id, redis, logger })

//     return { trade_id, trade_definition, trade_state }
//   }
//   describe("create_new_trade", function () {
//     describe("determines and sets allowed to buy", function () {
//       it("true if buy_price supplied", async function () {
//         let { trade_state } = await setup({ td_config: { buy_price: "1" } })
//         expect(await trade_state.get_buying_allowed()).to.be.true
//       })
//       it("false if buy_price undefined", async function () {
//         let { trade_state } = await setup({ td_config: { stop_price: "1", soft_entry: false } })
//         expect(await trade_state.get_buying_allowed()).to.be.false
//       })
//     })
//     it("sets base_amount_imported from trade_definition", async function () {
//       let { trade_state } = await setup({
//         td_config: { base_amount_imported: "100", buy_price: "1", target_price: "10" },
//       })
//       expect(await trade_state.get_base_amount_held()).to.bignumber.equal("100")
//     })
//   })
// })
