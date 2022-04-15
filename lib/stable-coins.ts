export let stable_coins: string[] = ["UST", "TUSD", "USDP", "USDC", "BUSD", "USDT"]
export let fiat: string[] = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "ZAR"]

export let non_volatile_coins: string[] = ["EGLD"]

export let disallowed_base_assets_for_entry: string[] = stable_coins.concat(fiat).concat(non_volatile_coins)
