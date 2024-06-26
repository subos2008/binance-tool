/// <reference types="../chai-bignumber" />

/**
 * This tests the raw underlying library - just to make sure we are integrating it properly.
 * 
 * Mirrors the authors tests
 */

import { expect } from "chai"
import * as chai from "chai"
import { BigNumber } from "bignumber.js"
const chaiBignumber = require("chai-bignumber")
chai.use(chaiBignumber())
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

const Logger = require("../lib/faux_logger")

const null_logger = new Logger({ silent: true })
const logger: Logger = null_logger

import { ADX_STRING_CANDLE, EntrySignals, EntrySignalsCallbacks } from "../classes/edges/pure-adx"
import { Logger } from "../interfaces/logger"
import { ADXInput } from "technicalindicators/declarations/directionalmovement/ADX"
import { ADX } from "technicalindicators"

const period = 14
const input_unmunged = {
  close: [
    29.87, 30.24, 30.1, 28.9, 28.92, 28.48, 28.56, 27.56, 28.47, 28.28, 27.49, 27.23, 26.35, 26.33, 27.03, 26.22,
    26.01, 25.46, 27.03, 27.45, 28.36, 28.43, 27.95, 29.01, 29.38, 29.36, 28.91, 30.61, 30.05, 30.19, 31.12, 30.54,
    29.78, 30.04, 30.49, 31.47, 32.05, 31.97, 31.13, 31.66, 32.64, 32.59, 32.19, 32.1, 32.93, 33.0, 31.94,
  ],
  high: [
    30.2, 30.28, 30.45, 29.35, 29.35, 29.29, 28.83, 28.73, 28.67, 28.85, 28.64, 27.68, 27.21, 26.87, 27.41, 26.94,
    26.52, 26.52, 27.09, 27.69, 28.45, 28.53, 28.67, 29.01, 29.87, 29.8, 29.75, 30.65, 30.6, 30.76, 31.17, 30.89,
    30.04, 30.66, 30.6, 31.97, 32.1, 32.03, 31.63, 31.85, 32.71, 32.76, 32.58, 32.13, 33.12, 33.19, 32.52,
  ],
  low: [
    29.41, 29.32, 29.96, 28.74, 28.56, 28.41, 28.08, 27.43, 27.66, 27.83, 27.4, 27.09, 26.18, 26.13, 26.63, 26.13,
    25.43, 25.35, 25.88, 26.96, 27.14, 28.01, 27.88, 27.99, 28.76, 29.14, 28.71, 28.93, 30.03, 29.39, 30.14, 30.43,
    29.35, 29.99, 29.52, 30.94, 31.54, 31.36, 30.92, 31.2, 32.13, 32.23, 31.97, 31.56, 32.21, 32.63, 31.76,
  ],
  period: period,
}

function munge_input(x: ADXInput) {
  let len = x.close.length
  let res = []
  for (let i = 0; i < len; i++) {
    let candle: ADX_STRING_CANDLE = {
      high: x.high[i].toString(),
      low: x.low[i].toString(),
      close: x.close[i].toString(),
    }
    res.push({ ...candle, closeTime: 1e6 * (i + 1) })
  }
  return res
}

const input = munge_input(input_unmunged)

const expectResult = [
  {
    "adx": 33.70788849599704,
    "mdi": 18.116192555042613,
    "pdi": 23.718186893672044,
  },
  {
    "adx": 32.256674079436806,
    "mdi": 17.360948613749574,
    "pdi": 22.72940203198124,
  },
  {
    "adx": 30.018345619444343,
    "mdi": 20.17542094822075,
    "pdi": 20.550126792049156,
  },
  {
    "adx": 28.439012595686158,
    "mdi": 18.72204272969499,
    "pdi": 21.937250896300913,
  },
  {
    "adx": 26.97248907362499,
    "mdi": 17.797126339975456,
    "pdi": 20.85349506942225,
  },
  {
    "adx": 25.847323911213152,
    "mdi": 23.928903398549593,
    "pdi": 19.10088505720813,
  },
  {
    "adx": 24.017906430971514,
    "mdi": 22.427790620529375,
    "pdi": 22.32241320401099,
  },
  {
    "adx": 22.85086147775649,
    "mdi": 24.042575888819258,
    "pdi": 20.613325486941086,
  },
  {
    "adx": 22.129747886876853,
    "mdi": 21.601760160516733,
    "pdi": 27.9181603183101,
  },
  {
    "adx": 21.57869470891934,
    "mdi": 20.64114106178586,
    "pdi": 27.59427841755249,
  },
  {
    "adx": 20.841568435721417,
    "mdi": 20.912545072268006,
    "pdi": 26.21905777631746,
  },
  {
    "adx": 19.61908179692733,
    "mdi": 22.497586315867906,
    "pdi": 24.239357953501997,
  },
  {
    "adx": 18.72577768656732,
    "mdi": 21.30940824159246,
    "pdi": 24.572938960734678,
  },
  {
    "adx": 18.751962418956367,
    "mdi": 19.677287360163756,
    "pdi": 28.964072883200057,
  },
  {
    "adx": 18.82256916633815,
    "mdi": 18.89078124365505,
    "pdi": 28.183449457987933,
  },
  {
    "adx": 18.52094194845808,
    "mdi": 19.99555317354794,
    "pdi": 26.832324023553472,
  },
  {
    "adx": 17.684613039701503,
    "mdi": 22.24279473593016,
    "pdi": 25.494843646184236,
  },
  {
    "adx": 17.90758568664478,
    "mdi": 20.464233142299246,
    "pdi": 31.217188685051074,
  },
  {
    "adx": 18.17858351323038,
    "mdi": 19.540416237637213,
    "pdi": 30.372238610706088,
  },
  {
    "adx": 17.28769386037729,
    "mdi": 24.460090756499206,
    "pdi": 27.42046167925381,
  },
]

class CallbacksLog implements EntrySignalsCallbacks {
  in_position(): boolean {
    return false
  }
  entry_signal({
    symbol,
    entry_price,
    direction,
  }: {
    symbol: string
    entry_price: BigNumber
    direction: "long" | "short"
  }): void {}
}

const symbol = "TESTPAIR"
describe("ADX (Average Directional Index)", function () {
  describe("Author's dataset", function () {
    function setup(initial_candles: ADX_STRING_CANDLE[]) {
      let entry_signals = new EntrySignals({
        logger,
        symbol,
        initial_candles,
        callbacks: new CallbacksLog(),
      })
      return entry_signals
    }


    describe("RAW ADX(initial_candles) only", function () {
      it("matches all the expected output values", function () {
        var adx = new ADX(input_unmunged);
        expect(adx.getResult()).to.deep.equal(expectResult)
      })
    })

    describe("EntrySignals(initial_candles) only", function () {
      it("matches all the expected output values", function () {
        const entry_signals: EntrySignals = setup(input)
        expect(entry_signals.adx.getResult()).to.deep.equal(expectResult)
      })
    })

    describe("no initial candles", function () {
      it("matches all the expected output values", function () {
        const entry_signals: EntrySignals = setup([])
        let result = []
        for (let i = 0; i < input.length; i++) {
          entry_signals.ingest_new_candle({ candle: input[i], symbol, timeframe: "1d" })
          if (entry_signals.current_result) result.push(entry_signals.current_result)
        }
        expect(result).to.deep.equal(expectResult)
      })
    })
  })
})
