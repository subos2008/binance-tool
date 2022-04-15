import { ExchangeInfo } from "binance-api-node"
import { BinanceExchangeInfoGetter } from "../../classes/exchanges/binance/exchange-info-getter"
import { Logger } from "../../interfaces/logger"
import { disallowed_base_assets_for_entry } from "../../lib/stable-coins"

export class BaseAssetsList {
  logger: Logger
  exchange_info_getter: BinanceExchangeInfoGetter

  constructor(args: { logger: Logger; exchange_info_getter: BinanceExchangeInfoGetter }) {
    this.logger = args.logger
    this.exchange_info_getter = args.exchange_info_getter
  }

  /**
   * Returns base_assets that are available on both the quote the TAS is using (not USDT because it's a scam)
   * and the quote the Algo uses (USDT because it's mot liquid) */
  async get_base_assets_list(config: { signals_quote_asset: string; tas_quote_asset: string }): Promise<string[]> {
    let tas_quote_asset = config.tas_quote_asset.toUpperCase()
    let signals_quote_asset = config.signals_quote_asset.toUpperCase()

    let exchange_info: ExchangeInfo = await this.exchange_info_getter.get_exchange_info()
    let symbols = exchange_info.symbols.filter((s) => s.isSpotTradingAllowed && s.status === "TRADING")
    this.logger.info(`${symbols.length} spot tradeable symbols on Binance`)
    symbols = symbols.filter((s) => s.baseAssetPrecision === 8 && s.quoteAssetPrecision === 8)
    symbols = symbols.filter((s) => s.ocoAllowed)
    this.logger.info(`${symbols.length} of those assets have a precision of 8`)

    let signal_assets = new Set(
      symbols.filter((s) => s.quoteAsset === signals_quote_asset).map((s) => s.baseAsset)
    )
    this.logger.info(`${signal_assets.size} base_assets on Binance available on signals ${signals_quote_asset}`)
    let tas_assets = new Set(symbols.filter((s) => s.quoteAsset === tas_quote_asset).map((s) => s.baseAsset))
    this.logger.info(`${tas_assets.size} base_assets on Binance available on signals ${tas_quote_asset}`)

    /** compute intersection */
    let target_assets = new Set<string>()
    for (var x of signal_assets) if (tas_assets.has(x)) target_assets.add(x)

    let targets: string[] = Array.from(target_assets)
    this.logger.info(
      `${targets.length} base_assets on Binance available on both ${signals_quote_asset} and ${tas_quote_asset}`
    )

    targets = targets.filter((x) => !disallowed_base_assets_for_entry.includes(x))
    return targets
  }
}
