export let stable_coins: string[] = ["UST", "TUSD", "USDP", "USDC", "BUSD", "USDT", "PAXG"]
export let fiat: string[] = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "ZAR"]

export let non_volatile_coins: string[] = ["EGLD"]

let delisted_coins = [
  "EZ",
  "QSP",
  "BRD",
  "NXS",
  "NAV",
  "MDA",
  "SPARTA",
  "API3",
  "BLZ",
  "GHST",
  "NEXO",
  "STPT",
  "WIN",
]

let mehran = [
  "USDC",
  "UST",
  "BUSD",
  "DAI",
  "TUSD",
  "USDN",
  "USDP",
  "FEI",
  "TRIBE",
  "FRAX",
  "LUSD",
  "HUSD",
  "GUSD",
  "RSR",
  "USDX",
  "XSGD",
  "EURS",
  "SUSD",
  "OUSD",
  "CUSD",
  "QC",
  "VAI",
  "SBD",
  "MUSD",
  "DGD",
  "RSV",
  "USDK",
  "IDRT",
  "BITCNY",
  "EOSDT",
  "XCHF",
  "XAUR",
  "NuBits",
  "USNBT",
  "ITL",
  "MIM",
  "EURT",
  "TOR",
  "XIDR",
  "ALUSD",
  "TRYB",
  "CEUR",
  "USDs",
  "MTR",
  "1GOLD",
  "XUSD",
  "ZUSD",
  "COFFIN",
  "DPT",
  "PAR",
  "BRCP",
  "MDO",
  "USDB",
  "MDS",
]

export let disallowed_base_assets_for_entry: string[] = stable_coins
  .concat(fiat)
  .concat(non_volatile_coins)
  .concat(mehran)
  .concat(delisted_coins)
