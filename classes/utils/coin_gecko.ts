const CoinGecko = require("coingecko-api")
const CoinGeckoClient = new CoinGeckoAPI()

type Response = {
  success: Boolean
  message: String
  code: Number
  data: Object
}

export class CoinGeckoAPI {
  async get_top_market_data({ limit }: { limit: number }) {
    let response: Response = await CoinGeckoClient.coins.markets({
      order: CoinGecko.ORDER.MARKET_CAP_DESC,
      per_page: limit,
    })
    if (!response.success) throw new Error(`Call to CoinGeckoClient.coins.markets failed`)
    return response.data
  }
}
