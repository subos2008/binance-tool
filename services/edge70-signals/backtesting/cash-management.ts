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
  private loan_available: BigNumber
  private loan: BigNumber = new BigNumber(0)

  constructor({
    starting_cash,
    logger,
    loan_available,
  }: {
    loan_available: string | BigNumber | number
    starting_cash: string | BigNumber | number
    logger: ServiceLogger
  }) {
    this.cash = new BigNumber(starting_cash)
    this.loan_available = new BigNumber(loan_available)
    this.logger = logger
  }

  private get_loan(desired_amount: BigNumber) {
    let loan_amount = BigNumber.max(desired_amount, this.loan_available)

    this.loan_available = this.loan_available.minus(loan_amount)
    this.loan = this.loan.plus(loan_amount)
    this.cash = this.cash.plus(loan_amount)

    this.logger.event(
      {},
      {
        object_type: "BankLoanRequest",
        msg: `Took loan of ${loan_amount.toFixed(1)}, total loan now ${this.loan.toFixed(
          1
        )}, remaining ${this.loan_available.toFixed(1)}`,
      }
    )
  }

  withdraw_cash(amount: BigNumber): BigNumber {
    if (this.cash.isLessThan(amount)) {
      let desired_amount = amount.minus(this.cash)
      this.get_loan(desired_amount)
    }

    let withdrawal_amount = BigNumber.min(amount, this.cash)
    this.cash = this.cash.minus(withdrawal_amount)

    return withdrawal_amount
  }

  pay_in_cash(amount: BigNumber): void {
    this.cash = this.cash.plus(amount)
  }

  balances(): { cash: BigNumber; loan: BigNumber } {
    let { cash, loan } = this
    return { cash, loan }
  }
}
