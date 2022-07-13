import { Binance } from "binance-api-node"
import { Balance } from "../../portfolio"
import { CurrentPortfolioGetter } from "../generic/portfolio-getter"

import Sentry from "../../../lib/sentry"

export class BinancePortfolioGetter implements CurrentPortfolioGetter {
  ee: Binance
  prices: { [symbol: string]: string } | null = null

  constructor({ ee }: { ee: Binance }) {
    this.ee = ee
  }

  async get_balances(): Promise<Balance[]> {
    try {
      let response = await this.ee.accountInfo()
      /* Hardcode remove AGI from balances as it's dud */
      let balances = response.balances.filter((bal) => bal.asset !== "AGI")
      return balances
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  }
}
