// const CoinGecko = require("coingecko-api")
// const CoinGeckoClient = new CoinGecko()

type Response = {
  success: Boolean
  message: String
  code: Number
  data: Object
}

export type CoinGeckoMarketData = {
  id: string
  symbol: string
  name: string
  // image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png?1547033579',
  // current_price: 50547,
  market_cap: number
  market_cap_rank: number
  // fully_diluted_valuation: 1061050936585,
  // total_volume: 100172937882,
  // high_24h: 57160,
  // low_24h: 47602,
  // price_change_24h: -6285.29260173,
  // price_change_percentage_24h: -11.05942,
  // market_cap_change_24h: -120335059202.99353,
  // market_cap_change_percentage_24h: -11.29245,
  // circulating_supply: 18708881,
  // total_supply: 21000000,
  // max_supply: 21000000,
  // ath: 64805,
  // ath_change_percentage: -22.0331,
  // ath_date: '2021-04-14T11:54:46.763Z',
  // atl: 67.81,
  // atl_change_percentage: 74412.57956,
  // atl_date: '2013-07-06T00:00:00.000Z',
  // roi: null,
  // last_updated: '2021-05-13T08:41:24.449Z'
}

// export class CoinGeckoAPI {
//   async get_top_market_data({ limit }: { limit: number }): Promise<CoinGeckoMarketData[]> {
//     let response: Response = await CoinGeckoClient.coins.markets({
//       order: CoinGecko.ORDER.MARKET_CAP_DESC,
//       per_page: limit,
//     })
//     if (!response.success) throw new Error(`Call to CoinGeckoClient.coins.markets failed`)
//     return response.data as CoinGeckoMarketData[]
//   }
// }
