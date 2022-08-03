export type Direction = "short" | "long" // Redis returns null for unset

export interface DirectionPersistance {
  set_direction(symbol: string, direction: Direction): Promise<Direction | null>
  get_direction(symbol: string): Promise<Direction | null>
}
