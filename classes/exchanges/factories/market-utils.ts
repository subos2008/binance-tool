/* Creates an exchange specific ExchangeUtils insttance from an ExchangeIdentifier */

import { BinanceMarketUtils } from "../binance/market-utils"
import { MarketUtils } from "../../../interfaces/exchange/generic/market-utils"
import { Logger } from "../../../interfaces/logger"
import { MarketIdentifier } from "../../../events/shared/market-identifier"

export async function createMarketUtils({
  logger,
  market_identifier,
}: {
  logger: Logger
  market_identifier: MarketIdentifier
}): Promise<MarketUtils> {
  if (market_identifier.exchange_identifier.exchange === "binance")
    return new BinanceMarketUtils({ logger, market_identifier })
  throw new Error(`Exchange ${market_identifier.exchange_identifier.exchange} not implemented`)
}
