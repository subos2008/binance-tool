export type SendMessageFunc = (msg: string, tags?: ContextTags) => Promise<void>

// TODO: idea, make a top level observability/ dir and put global tags styles (facets) in there
export interface ContextTags {
  edge?: string
  base_asset?: string // depricate in favour of some kind of context object?
  class?: string // name of the class calling send_message
  exchange_type?: "spot" | "futures"
}
