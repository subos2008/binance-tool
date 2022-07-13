import { strict as assert } from 'assert';
import { Logger } from "../interfaces/logger";

import Sentry from "../lib/sentry"

export class BinancePriceMonitor {
  logger: Logger
  send_message: (msg: string) => void
  closeTradesWebSocket: (() => void) | undefined
  ee: any
  price_event_callback: (symbol: string, price: string, raw: any) => Promise<void>

  constructor(logger: Logger, send_message: (msg: string) => void, ee: any,
    price_event_callback: (symbol: string, price: string, raw: any) => Promise<void>) {

    this.logger = logger
    this.send_message = send_message
    this.ee = ee
    this.price_event_callback = price_event_callback
  }

  shutdown_streams() {
    if (this.closeTradesWebSocket) {
      this.logger.info(`Shutting down streams`);
      this.closeTradesWebSocket();
      this.closeTradesWebSocket = undefined
    }
  }

  async monitor_pairs(pairs_to_watch: string[]) {
    this.logger.info(`Watching pairs: ${pairs_to_watch.join(', ')}`)
    this.closeTradesWebSocket = await this.ee.ws.aggTrades(
      pairs_to_watch,
      async (trade: { symbol: string, price: string }) => {
        try {
          var { symbol, price: string_price } = trade;
          assert(symbol);
          assert(string_price);
          // this.logger.info(`${symbol}: ${string_price}`) # spams logging ingestion
          await this.price_event_callback(symbol, string_price, trade)
        } catch (err) {
          Sentry.captureException(err);
        }
      }
    );
  }
}
