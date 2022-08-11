import { BigNumber } from "bignumber.js"
import { ServiceLogger } from "../../interfaces/logger"
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
  dollar_loans: boolean

  constructor({
    starting_cash,
    logger,
    loan_available,
    dollar_loans,
  }: {
    loan_available: string | BigNumber | number
    starting_cash: string | BigNumber | number
    logger: ServiceLogger
    dollar_loans: boolean
  }) {
    this.cash = new BigNumber(starting_cash)
    this.loan_available = new BigNumber(loan_available)
    this.logger = logger
    this.dollar_loans = dollar_loans
  }

  private get_loan(desired_amount: BigNumber) {
    let loan_amount = BigNumber.min(desired_amount, this.loan_available)

    this.loan_available = this.loan_available.minus(loan_amount)
    this.loan = this.loan.plus(loan_amount)
    this.cash = this.cash.plus(loan_amount)

    if (this.loan_available.isLessThan(0)) throw new Error(`bug in loans code`)

    if (loan_amount.isZero() && this.dollar_loans) {
      /* no financial value but allows positions tracking + indicates running out of capital */
      this.loan_available = new BigNumber(1)
      this.get_loan(desired_amount)
    }

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
