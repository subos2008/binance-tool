import { ExchangeInfo } from "binance-api-node"
import { ExchangeIdentifier_V4 } from "../../events/shared/exchange-identifier"
import { ExchangeInfoGetter } from "../../interfaces/exchanges/binance/exchange-info-getter"

export class MockExchangeInfoGetter implements ExchangeInfoGetter {
  get_exchange_identifier(): ExchangeIdentifier_V4 {
    let ei: ExchangeIdentifier_V4 = {
      version: 4,
      exchange: "binance-backtester",
      exchange_type: "spot",
    }
    return ei
  }

  async get_exchange_info(): Promise<ExchangeInfo> {
    throw new Error(`Not Implemented`)
  }

  /* base_asset <-> symbol is always a headache but it lives nicely here */
  async to_symbol(args: { base_asset: string; quote_asset: string }): Promise<string | undefined> {
    return `${args.base_asset.toUpperCase()}${args.quote_asset.toUpperCase()}`
  }
}
