import { BigNumber } from "bignumber.js"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { PositionsSnapshot } from "./positions-snapshot"

export class PortfolioSummary {
  timestamp: Date
  cash: BigNumber
  loan: BigNumber
  positions_snapshot: PositionsSnapshot
  quote_asset: string
  private portfolio_value: BigNumber | undefined

  constructor(args: {
    timestamp: Date
    quote_asset: string
    cash: BigNumber
    loan: BigNumber
    positions_snapshot: PositionsSnapshot
  }) {
    this.timestamp = args.timestamp
    this.quote_asset = args.quote_asset
    this.cash = args.cash
    this.loan = args.loan
    this.positions_snapshot = args.positions_snapshot
  }

  /************************************************************
   * Metrics
   */

  async total_investments_value(): Promise<BigNumber> {
    let { quote_asset } = this
    if (!this.portfolio_value)
      this.portfolio_value = await this.positions_snapshot.get_total_value_in_quote_asset({ quote_asset })
    return this.portfolio_value
  }

  async total_assets_inc_cash(): Promise<BigNumber> {
    return this.cash.plus(await this.total_investments_value())
  }

  async net_worth(): Promise<BigNumber> {
    return this.cash.plus((await this.total_investments_value()).minus(this.loan))
  }

  async pct_portfolio_invested(): Promise<BigNumber> {
    let investments = await this.total_investments_value()
    let total = await this.total_assets_inc_cash()
    return investments.dividedBy(total).times(100)
  }

  async portfolio_percentages() {
    let investments = await this.total_investments_value()
    let total = await this.total_assets_inc_cash()
    return {
      investments: investments.dividedBy(total).times(100),
      cash: this.cash.dividedBy(total).times(100),
    }
  }

  async open_positions_count(): Promise<number> {
    return this.positions_snapshot.positions.length
  }
}
