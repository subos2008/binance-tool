import { FuturesAsset } from "binance-api-node"
import { ExchangeIdentifier } from "../../../../events/shared/exchange-identifier"
import { FuturesPortfolio } from "../../../../interfaces/portfolio"

export interface MasterPortfolioClass {
  set_portfolio_for_exchange({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier
    portfolio: FuturesPortfolio
  }): Promise<void>
}

export interface FuturesPortfolioBitchClass {
  get_balances_from_exchange(): Promise<FuturesAsset[]>
  start(): Promise<void> // start listening for order events and submitting updated portfolios
  update_portfolio_from_exchange(): Promise<void> // do it right now
}
