import { ExchangeInfo } from "binance-api-node"
import { ExchangeIdentifier_V4 } from "../../../events/shared/exchange-identifier"

export interface ExchangeInfoGetter {
  get_exchange_identifier(): ExchangeIdentifier_V4
  get_exchange_info(): Promise<ExchangeInfo>

  /* base_asset <-> symbol is always a headache but it lives nicely here */
  to_symbol(args: { base_asset: string; quote_asset: string }): Promise<string | undefined>
}
