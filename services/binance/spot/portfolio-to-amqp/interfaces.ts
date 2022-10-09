import { ExchangeIdentifier_V3 } from "../../../../events/shared/exchange-identifier"
import { Balance, Portfolio } from "../../../../interfaces/portfolio"

export interface MasterPortfolioClass {
  set_portfolio_for_exchange({
    exchange_identifier,
    portfolio,
  }: {
    exchange_identifier: ExchangeIdentifier_V3
    portfolio: Portfolio
  }): Promise<void>
}

export interface PortfolioBitchClass {
  get_balances_from_exchange(): Promise<Balance[]>
  start(): Promise<void> // start listening for order events and submitting updated portfolios
  update_portfolio_from_exchange(): Promise<void> // do it right now
}