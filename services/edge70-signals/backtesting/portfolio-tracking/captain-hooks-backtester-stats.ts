import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import {
  SpotPositionClosedEvent_V1_with_percentage_quote_change,
  SpotPositionOpenedEvent_V1,
} from "../../../../classes/spot/abstractions/spot-position-callbacks"
import { ServiceLogger } from "../../../../interfaces/logger"
import { BacktesterStatsHooks } from "./interfaces"
import humanNumber from "human-number"
import { PortfolioSummary } from "./portfolio-summary"

type Delta = { start: BigNumber; end: BigNumber }

class calc {
  static delta_as_pct(delta: Delta): number {
    let { start, end } = delta
    return end.dividedBy(start).times(100).dp(1).toNumber()
  }

  static sub_amount_as_pct(total: BigNumber, sub_amount: BigNumber): BigNumber {
    return sub_amount.dividedBy(total).times(100)
  }
}

class strings {
  static add_sign(n: number): string {
    return n < 0 ? `${n}` : `+${n}`
  }

  static human_usd(value: BigNumber): string {
    return "$" + humanNumber(value.toNumber())
  }

  static as_pct(delta: Delta): string {
    return this.add_sign(calc.delta_as_pct(delta)) + "%"
  }

  static sub_amount_as_pct(total: BigNumber, sub_amount: BigNumber): string {
    return calc.sub_amount_as_pct(total, sub_amount).toFixed(1) + "%"
  }
}

export class CaptainHooksBacktesterStats implements BacktesterStatsHooks {
  logger: ServiceLogger

  position_opened_events: SpotPositionOpenedEvent_V1[] = []
  position_closed_events: SpotPositionClosedEvent_V1_with_percentage_quote_change[] = []

  // at_start: PortfolioSummary
  current: PortfolioSummary | undefined

  // highest_net_worth: BigNumber

  // total_assets_value : {
  //   at_start: BigNumber
  //   highest: BigNumber
  //   lowest: BigNumber
  //   current: BigNumber
  // }

  constructor(args: { logger: ServiceLogger }) {
    this.logger = args.logger
  }

  async on_position_opened(event: SpotPositionOpenedEvent_V1) {
    this.position_opened_events.push(event)
  }
  async on_position_closed(event: SpotPositionClosedEvent_V1_with_percentage_quote_change) {
    this.position_closed_events.push(event)
  }

  /* call this to update this object with the latest info! */
  async portfolio_summary_at_candle_close(portfolio_sumary: PortfolioSummary) {
    this.current = portfolio_sumary
  }

  private summary_positions_opened_closed() {
    let wins = this.position_closed_events.filter((p) => p.percentage_quote_change >= 0)
    let losses = this.position_closed_events.filter((p) => p.percentage_quote_change < 0)
    return {
      object_type: `HooksPositionsSumary`,
      msg: `${this.position_opened_events.length} opened, ${this.position_closed_events.length} closed.  ${wins} WINS, ${losses} LOSSES`,
    }
  }

  private async summary_positions_net_worth() {
    if (!this.current)
      return {
        object_type: `HooksNetWorthSumary`,
        msg: `No Data.`,
      }

    let { quote_asset } = this.current
    let cash: BigNumber = this.current.cash
    let total_assets_value: BigNumber = await this.current.total_assets_inc_cash()
    let investments: BigNumber = await this.current.total_investments_value()
    return {
      object_type: `HooksNetWorthSumary`,
      msg: `${quote_asset}: ${total_assets_value} total as ${cash.toFixed(0)} cash and ${investments} investments`,
    }
  }

  async summary() {
    let positions_summary_event = this.summary_positions_opened_closed()
    this.logger.event({}, positions_summary_event)

    let net_worth_summary_event = await this.summary_positions_net_worth()
    this.logger.event({}, net_worth_summary_event)

    // let msg: string[] = [
    //   `Net Worth \$${strings.total_assets_value(portfolio)} X% cash y% invested`,
    //   `Invested $200k -> 700k`,
    //   `Loan used $500`,
    // ]
  }
}
