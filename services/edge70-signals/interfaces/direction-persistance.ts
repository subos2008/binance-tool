export type Direction = "short" | "long" // Redis returns null for unset

export interface DirectionPersistence {
  set_direction(base_asset: string, direction: Direction): Promise<Direction | null>
  get_direction(base_asset: string): Promise<Direction | null>
}
