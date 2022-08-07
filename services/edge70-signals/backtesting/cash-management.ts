import { BigNumber } from "bignumber.js"
import { ServiceLogger } from "../../../interfaces/logger"
BigNumber.DEBUG = true // Prevent NaN
// Prevent type coercion
BigNumber.prototype.valueOf = function () {
  throw Error("BigNumber .valueOf called!")
}

import { BankOfBacktesting } from "./portfolio-tracking/interfaces"

export class BacktesterCashManagement implements BankOfBacktesting {
  private logger: ServiceLogger
  private cash: BigNumber
  private loan: BigNumber = new BigNumber(0)

  constructor({ starting_cash, logger }: { starting_cash: BigNumber; logger: ServiceLogger }) {
    this.cash = starting_cash
    this.logger = logger
  }

  withdraw_cash(amount: BigNumber): BigNumber {
    this.cash = this.cash.minus(amount)
    if (this.cash.isLessThan(0)) {
      let loan_amount = this.cash.abs()
      this.loan = this.loan.plus(loan_amount)
      this.cash = this.cash.plus(loan_amount) // 0

      this.logger.event(
        {},
        {
          object_type: "TookOutLoan",
          msg: `Took loan of ${loan_amount.toFixed(1)}, total loan now ${this.loan.toFixed(1)}`,
        }
      )
    }
    return amount
  }

  pay_in_cash(amount: BigNumber): void {
    this.cash = this.cash.plus(amount)
  }

  balances(): { cash: BigNumber; loan: BigNumber } {
    let { cash, loan } = this
    return { cash, loan }
  }
}
