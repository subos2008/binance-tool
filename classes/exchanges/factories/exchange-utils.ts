/* Creates an exchange specific ExchangeUtils insttance from an ExchangeIdentifier */

import { BinanceExchangeUtils } from "../binance/exchange-utils"
import { ExchangeUtils } from "../../../interfaces/exchange/generic/exchange-utils"
import { Logger } from "../../../interfaces/logger"
import { ExchangeIdentifier } from "../../../events/shared/exchange-identifier"

export async function createExchangeUtils({
  logger,
  exchange_identifier,
}: {
  logger: Logger
  exchange_identifier: ExchangeIdentifier
}): Promise<ExchangeUtils> {
  if (exchange_identifier.exchange === "binance")
    return new BinanceExchangeUtils({ logger, exchange_identifier })
  throw new Error(`Exchange ${exchange_identifier.exchange} not implemented`)
}
