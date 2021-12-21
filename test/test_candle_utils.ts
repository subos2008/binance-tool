/// <reference types="../chai-bignumber" />

import { expect } from 'chai'
import * as chai from 'chai'
import {BigNumber} from 'bignumber.js';
const chaiBignumber = require("chai-bignumber");
chai.use(chaiBignumber());
BigNumber.DEBUG = true; // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function() {
	throw Error('BigNumber .valueOf called!');
};

import { CandleInfo_OC } from "../classes/utils/candle_utils"

import { Logger } from "../interfaces/logger"
const LoggerClass = require("../lib/faux_logger")
const logger: Logger = new LoggerClass({ silent: true })

const tv_short_candle = { // -20.39% delta on TV
  open: "28.45",
  close: "22.65",
  high: "22.31",
  low: "29.01",
}

const tv_long_candle = { // +19.06% delta on TV
  open: "45.03",
  close: "53.59",
  high: "54.88",
  low: "43.11",
}

describe("CandleInfo_OC", function () {
  describe("percentage_change", function () {
    it("gives correct percentage on tv short candle", function () {
      let info = new CandleInfo_OC(tv_short_candle)
      expect(info.percentage_change()).to.be.bignumber.equal("-20.39")
    })
    it("gives correct percentage on tv long candle", function () {
      let info = new CandleInfo_OC(tv_long_candle)
      expect(info.percentage_change()).to.be.bignumber.equal("19.01") // Actually TV says 19.06
    })
  })
})

/**
 * open * X = close
 */
