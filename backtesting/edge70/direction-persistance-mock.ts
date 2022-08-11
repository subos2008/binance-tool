import { ServiceLogger } from "../../interfaces/logger"
import { DirectionPersistence } from "../../services/edge70-signals/interfaces/direction-persistance"

export type Direction = "short" | "long" // Redis returns null for unset

export class DirectionPersistenceMock implements DirectionPersistence {
  private logger: ServiceLogger
  private prefix: string
  base_assets: string[] | undefined
  private keys: { [key: string]: string } = {}

  constructor({ logger, prefix }: { logger: ServiceLogger; prefix: string }) {
    this.logger = logger
    this.prefix = prefix
  }

  private _market_to_key(base_asset: string): string {
    return `${this.prefix}:signal_direction:${base_asset.toUpperCase()}`
  }

  private set(key: string, value: any) {
    this.keys[key] = value
  }

  private get(key: string) {
    return this.keys[key]
  }

  set_base_assets(base_assets: string[]) {
    this.base_assets = base_assets
  }

  async set_direction(base_asset: string, direction: Direction) {
    let previous_direction = await this.get_direction(base_asset)
    if (previous_direction === null) {
      this.logger.info(`Initialising direction for ${base_asset} to ${direction}`)
    } else if (previous_direction !== direction) {
      this.logger.debug(`Direction change to ${direction} for ${base_asset}`)
    }
    this.set(this._market_to_key(base_asset), direction)
    return previous_direction
  }

  async get_direction(base_asset: string): Promise<Direction | null> {
    let direction = await this.get(this._market_to_key(base_asset))
    return direction as Direction
  }

  async get_all_market_stats() {
    if (!this.base_assets) throw new Error(`base_assets not initialised`)
    let long = 0,
      short = 0,
      unknown = 0
    for (const base_asset of this.base_assets) {
      let dir: Direction | null = await this.get_direction(base_asset)
      if (!dir) unknown++
      if (dir === "long") long++
      if (dir === "short") short++
    }
    return { long, short, unknown }
  }
}
