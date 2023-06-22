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
  let precision: number
  try {
    precision = formatter.format(tickSize).split(".")?.[1]?.length || 0
  } catch (e) {
    precision = 0
  }
  if (typeof price === "string") price = new BigNumber(price)
  return price.toFixed(precision)
}


