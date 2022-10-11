import { ExchangeIdentifier } from "../../../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../../../interfaces/portfolio"

export interface MasterPortfolioClass {
  set_portfolio_for_exchange({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier
    portfolio: Portfolio
  }): Promise<void>
}

export interface PortfolioBitchClass {
  start(): Promise<void> // start listening for order events and submitting updated portfolios
  update_portfolio_from_exchange(): Promise<void> // do it right now
}
