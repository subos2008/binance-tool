import { BigNumber } from "bignumber.js"
import {
  SpotPositionCallbacks,
  SpotPositionClosed,
  SpotPositionOpenedEvent_V1,
} from "../../../classes/spot/abstractions/spot-position-callbacks"
import { EdgeCandle } from "../../../services/edge70-signals/interfaces/_internal"
import { PortfolioSummary } from "./portfolio-summary"

export interface BacktesterStatsHooks extends SpotPositionCallbacks {
  on_position_opened(event: SpotPositionOpenedEvent_V1): Promise<void>
  on_position_closed(event: SpotPositionClosed): Promise<void>

  portfolio_summary_at_candle_close(portfolio: PortfolioSummary): Promise<void>
}

export type CandlesMap = { [symbol: string]: EdgeCandle }

export interface BankOfBacktesting {
  withdraw_cash(amount: BigNumber): BigNumber
  pay_in_cash(amount: BigNumber): void
  balances(): { cash: BigNumber; loan: BigNumber }
}
