import { ServiceLogger } from "../../../interfaces/logger"
import { DirectionPersistence } from "../interfaces/direction-persistance"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistenceMock implements DirectionPersistence {
  private logger: ServiceLogger
  private prefix: string
  symbols: string[] | undefined
  private keys: { [key: string]: string } = {}

  constructor({ logger, prefix }: { logger: ServiceLogger; prefix: string }) {
    this.logger = logger
    this.prefix = prefix
  }

  private _market_to_key(symbol: string): string {
    return `${this.prefix}:signal_direction:${symbol.toUpperCase()}`
  }

  private set(key: string, value: any) {
    this.keys[key] = value
  }

  private get(key: string) {
    return this.keys[key]
  }

  set_symbols(symbols: string[]) {
    this.symbols = symbols
  }

  async set_direction(symbol: string, direction: Direction) {
    let previous_direction = await this.get_direction(symbol)
    if (previous_direction === null) {
      this.logger.info(`Initialising direction for ${symbol} to ${direction}`)
    } else if (previous_direction !== direction) {
      this.logger.debug(`Direction change to ${direction} for ${symbol}`)
    }
    this.set(this._market_to_key(symbol), direction)
    return previous_direction
  }

  async get_direction(symbol: string): Promise<Direction | null> {
    let direction = await this.get(this._market_to_key(symbol))
    return direction as Direction
  }

  async get_all_market_stats() {
    if (!this.symbols) throw new Error(`Symbols not initialised`)
    let long = 0,
      short = 0,
      unknown = 0
    for (const symbol of this.symbols) {
      let dir: Direction | null = await this.get_direction(symbol)
      if (!dir) unknown++
      if (dir === "long") long++
      if (dir === "short") short++
    }
    return { long, short, unknown }
  }
}
