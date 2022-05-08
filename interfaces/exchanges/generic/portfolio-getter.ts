import { Balance } from "../../portfolio"

export interface CurrentPortfolioGetter {
  get_balances(): Promise<Balance[]>
}
