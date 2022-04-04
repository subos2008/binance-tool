import { strict as assert } from "assert"
import { BigNumber } from "bignumber.js"

// The amount of quote coin that can be bought, so rounds down
// TODO: decimal places is a hardcoded constant
export function quote_volume_at_price_to_base_volume({
  quote_volume,
  price,
}: {
  quote_volume: BigNumber
  price: BigNumber
}) {
  assert(quote_volume)
  assert(price)
  assert(BigNumber.isBigNumber(quote_volume))
  assert(BigNumber.isBigNumber(price), `Expected price (${price}) to be a BigNumber`)
  return quote_volume.dividedBy(price).dp(8, BigNumber.ROUND_DOWN)
}

// TODO: rounding
export function base_volume_at_price_to_quote_volume({
  base_volume,
  price,
}: {
  base_volume: BigNumber
  price: BigNumber
}) {
  assert(BigNumber.isBigNumber(base_volume))
  assert(BigNumber.isBigNumber(price))
  return base_volume.multipliedBy(price)
}

// Binance
export function roundStep(qty: BigNumber, stepSize: string) {
  // Integers do not require rounding
  if (Number.isInteger(qty.toNumber())) return qty
  const qtyString = qty.toFixed(16)
  const desiredDecimals = Math.max(stepSize.indexOf("1") - 1, 0)
  const decimalIndex = qtyString.indexOf(".")
  return new BigNumber(qtyString.slice(0, decimalIndex + desiredDecimals + 1))
}

// Binance
export function roundTicks(price: BigNumber, tickSize: number) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "decimal",
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  })
  // . not present for tickSize on some markets (i.e. 1 for MKRBUSD)
  const precision = formatter.format(tickSize).split(".")?.[1].length || 0
  if (typeof price === "string") price = new BigNumber(price)
  return price.toFixed(precision)
}

// Binance
export function get_symbol_filters({ exchange_info, symbol }: { exchange_info: any; symbol: string }) {
  // TODO: argh omg this is disgusting hardcoding of the default_pair
  let symbol_data = exchange_info.symbols.find((ei: any) => ei.symbol === symbol)
  if (!symbol_data) {
    // TODO: some kind of UnrecognisedPairError class?
    throw new Error(`Could not find exchange info for ${symbol}`)
  }
  return symbol_data.filters
}

// Binance
export function munge_and_check_quantity({
  exchange_info,
  symbol,
  volume,
}: {
  exchange_info: any
  symbol: string
  volume: BigNumber
}) {
  assert(typeof volume !== "undefined")
  assert(exchange_info)
  assert(symbol)
  let filters = get_symbol_filters({ exchange_info, symbol })
  const { stepSize, minQty } = filters.find((eis: any) => eis.filterType === "LOT_SIZE")
  volume = new BigNumber(roundStep(new BigNumber(volume), stepSize))
  if (volume.isLessThan(minQty)) {
    throw new Error(`${volume} does not meet minimum quantity (LOT_SIZE): ${minQty}.`)
  }
  return volume
}

// Binance
export function munge_and_check_price({
  exchange_info,
  symbol,
  price,
}: {
  exchange_info: any
  symbol: string
  price: BigNumber
}) {
  assert(typeof price !== "undefined")
  assert(exchange_info)
  assert(symbol)
  price = new BigNumber(price)
  if (price.isZero()) {
    return price // don't munge zero, special case for market buys
  }
  let filters = get_symbol_filters({ exchange_info, symbol })
  const { tickSize, minPrice } = filters.find((eis: any) => eis.filterType === "PRICE_FILTER")
  price = new BigNumber(roundTicks(price, tickSize))
  if (price.isLessThan(minPrice)) {
    throw new Error(`${price} does not meet minimum order price (PRICE_FILTER): ${minPrice}.`)
  }
  return price
}

// Binance
export function check_notional({
  price,
  volume,
  exchange_info,
  symbol,
}: {
  exchange_info: any
  symbol: string
  price: BigNumber
  volume: BigNumber
}) {
  assert(typeof volume !== "undefined")
  assert(typeof price !== "undefined")
  assert(exchange_info)
  assert(symbol)
  price = new BigNumber(price)
  if (price.isZero()) {
    return price // don't munge zero, special case for market buys
  }
  let filters = get_symbol_filters({ exchange_info, symbol })
  const { minNotional } = filters.find((eis: any) => eis.filterType === "MIN_NOTIONAL")
  let quote_volume = price.times(volume)
  if (quote_volume.isLessThan(minNotional)) {
    throw new Error(
      `does not meet minimum order value ${minNotional} (MIN_NOTIONAL) (Buy of ${volume} at ${price} = ${quote_volume}).`
    )
  }
}

export function is_too_small_to_trade({
  price,
  volume,
  exchange_info,
  symbol,
}: {
  exchange_info: any
  symbol: string
  price: BigNumber
  volume: BigNumber
}): boolean {
  try {
    check_notional({
      exchange_info,
      symbol,
      price: munge_and_check_price({ exchange_info, symbol, price }),
      volume: munge_and_check_quantity({ exchange_info, symbol, volume }),
    })
  } catch (e) {
    return true
  }
  return false
}
