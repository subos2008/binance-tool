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
import { HooksPortfolioSummaryMetrics } from "./metrics/portfolio-summary-metrics"
import { randomUUID } from "crypto"

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

  static pct(pct: BigNumber) {
    return `${pct.toFixed(1)}%`
  }

  static human_usd(value: BigNumber): string {
    return "$" + humanNumber(value.dp(0).toNumber())
  }

  static delta_as_pct(delta: Delta): string {
    let pct = calc.delta_as_pct(delta)
    let factor = new BigNumber(pct).dividedBy(100).dp(1)
    return `${pct}% (${factor}x)`
  }

  static sub_amount_as_pct(total: BigNumber, sub_amount: BigNumber): string {
    return calc.sub_amount_as_pct(total, sub_amount).toFixed(1) + "%"
  }
}

export class CaptainHooksBacktesterStats implements BacktesterStatsHooks {
  logger: ServiceLogger
  metrics: HooksPortfolioSummaryMetrics
  backtest_run_id: string

  position_opened_events: SpotPositionOpenedEvent_V1[] = []
  position_closed_events: SpotPositionClosedEvent_V1_with_percentage_quote_change[] = []
  cash_percent_positions: BigNumber[] = []
  total_assets: BigNumber[] = []
  pct_portfolio_invested: BigNumber[] = []
  open_positions_count: number[] = []

  at_start: PortfolioSummary | undefined
  current: PortfolioSummary | undefined

  constructor(args: { logger: ServiceLogger; quote_asset: string }) {
    this.logger = args.logger
    let { quote_asset } = args
    let backtest_run_id = randomUUID()
    this.backtest_run_id = backtest_run_id
    this.metrics = new HooksPortfolioSummaryMetrics({ logger: args.logger, backtest_run_id, quote_asset })
  }

  async shutdown() {
    await this.metrics.shutdown()
  }

  async on_position_opened(event: SpotPositionOpenedEvent_V1) {
    this.position_opened_events.push(event)
  }
  async on_position_closed(event: SpotPositionClosedEvent_V1_with_percentage_quote_change) {
    this.position_closed_events.push(event)
  }

  /* call this to update this object with the latest info! */
  async portfolio_summary_at_candle_close(portfolio_sumary: PortfolioSummary) {
    if (!this.at_start) this.at_start = portfolio_sumary
    this.current = portfolio_sumary

    await this.metrics.upload_metrics(portfolio_sumary)

    this.total_assets.push(await portfolio_sumary.total_assets_inc_cash())
    this.pct_portfolio_invested.push(await portfolio_sumary.pct_portfolio_invested())
    this.open_positions_count.push(await portfolio_sumary.open_positions_count())
  }

  private summary_positions_opened_closed() {
    let wins = this.position_closed_events.filter((p) => p.percentage_quote_change >= 0)
    let losses = this.position_closed_events.filter((p) => p.percentage_quote_change < 0)
    return {
      object_type: `HooksPositionsSummary`,
      msg: `${this.position_opened_events.length} opened, ${this.position_closed_events.length} closed.  ${wins} WINS, ${losses} LOSSES`,
    }
  }

  private async net_worth_summary() {
    if (!this.current) throw new Error(`no data`)
    let { quote_asset } = this.current
    let total_assets_value = strings.human_usd(await this.current.total_assets_inc_cash())
    let cash = strings.human_usd(this.current.cash)
    let investments = strings.human_usd(await this.current.total_investments_value())
    return {
      object_type: `HooksNetWorthSummary`,
      msg: `${quote_asset}: ${total_assets_value} total as ${cash} cash and ${investments} investments`,
    }
  }

  private async loan_summary() {
    if (!this.current) throw new Error(`no data`)
    let { quote_asset } = this.current
    let loan: BigNumber = this.current.loan
    return {
      object_type: `HooksLoanSummary`,
      msg: `${quote_asset}: ${loan}`,
    }
  }

  private async max_total_assets_summary() {
    if (!this.at_start) throw new Error(`no data for starting values`)
    let max = BigNumber.max(...this.total_assets)
    let start_cash: BigNumber = this.at_start.cash
    let cash_delta_pct = strings.delta_as_pct({ start: start_cash, end: max })
    let msg = `${strings.human_usd(start_cash)} -> ${strings.human_usd(max)} ${cash_delta_pct}`
    return {
      object_type: `MaxTotalAssets`,
      msg,
    }
  }

  private async pct_portfolio_invested_summary() {
    let avg_pct = BigNumber.sum(...this.pct_portfolio_invested).dividedBy(this.pct_portfolio_invested.length)
    let msg = `${strings.pct(avg_pct)}`
    return {
      object_type: `AveragePercentOfPortfolioInvested`,
      msg,
    }
  }

  private async open_positions_count_summary() {
    let avg_count = BigNumber.sum(...this.open_positions_count).dividedBy(this.open_positions_count.length)
    let max = BigNumber.max(...this.open_positions_count)
    // pct = max.dividedBy ... ahhh - #symbols tracked
    let msg = `Avg: ${avg_count.dp(0)} Highest: ${max}`
    return {
      object_type: `OpenPositionsCounts`,
      msg,
    }
  }

  private async net_worth_delta_summary() {
    if (!this.current) throw new Error(`no data: this.current`)
    if (!this.at_start) throw new Error(`no data for starting values`)
    let { quote_asset } = this.current

    let start_cash: BigNumber = this.at_start.cash
    let start_total_assets: BigNumber = await this.at_start.total_assets_inc_cash()

    let end_cash: BigNumber = this.current.cash
    let end_total_assets: BigNumber = await this.current.total_assets_inc_cash()

    let cash_delta_pct = strings.delta_as_pct({ start: start_cash, end: end_cash })
    let total_assets_delta_pct = strings.delta_as_pct({ start: start_total_assets, end: end_total_assets })

    // let msg = `${quote_asset}: Cash: ${cash_delta_pct} Total: ${total_assets_delta_pct}`

    let cash_str = `${strings.human_usd(start_cash)} -> ${strings.human_usd(end_cash)} ${cash_delta_pct}`
    let total_assets_str = `${strings.human_usd(start_total_assets)} -> ${strings.human_usd(
      end_total_assets
    )} ${total_assets_delta_pct}`
    let msg = `${quote_asset}: Cash: ${cash_str} Total: ${total_assets_str}`

    return {
      object_type: `HooksNetWorthDeltaSummary`,
      msg,
    }
  }

  async summary() {
    if (!this.current) {
      this.logger.event({}, { object_type: `HooksSummaryNoData`, msg: `No Data.` })
      return
    }

    this.logger.event({}, this.summary_positions_opened_closed())
    this.logger.event({}, await this.loan_summary())
    this.logger.event({}, await this.net_worth_summary())
    this.logger.event({}, await this.net_worth_delta_summary())
    this.logger.event({}, await this.max_total_assets_summary())
    this.logger.event({}, await this.pct_portfolio_invested_summary())
    this.logger.event({}, await this.open_positions_count_summary())

    this.logger.event({}, { object_type: `BacktestID`, msg: this.backtest_run_id })

    // let msg: string[] = [
    //   `Net Worth \$${strings.total_assets_value(portfolio)} X% cash y% invested`,
    //   `Invested $200k -> 700k`,
    //   `Loan used $500`,
    // ]

    /**
     * Add:
     * - max percentage of portfolio invested
     * - portfolio is 100% cash (like are we in positions at the end)
     * - average % portfolio allocated
     * - mac total_assets value
     */

    /**
     * Metrics:
     * - % portfolio invested
     * - num positions open
     * - loan, cash, investments value
     */
  }
}
