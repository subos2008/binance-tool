export interface TradeAbstractionOpenShortCommand {
  object_type: "TradeAbstractionOpenShortCommand"
  base_asset: string
  edge: string
  direction: "short"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
}

interface TradeAbstractionOpenShortResult_SUCCESS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary
  http_status: 201 // 201: Created

  buy_filled: true

  // signal
  trigger_price?: string

  // Post munging requested values
  requested_quote_quantity: string
  requested_price: string

  // Actual execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price: string // can be null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

interface TradeAbstractionOpenShortResult_BAD_INPUTS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset?: string
  quote_asset?: string
  edge?: string

  status: "BAD_INPUTS" // exception caught
  http_status: 400

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

export interface TradeAbstractionOpenShortResult_NOT_FOUND {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge?: string

  status: "NOT_FOUND" // exception caught
  http_status: 404

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined // Hmm, need to have these
  take_profit_order_id?: string | number | undefined // Hmm, need to have these

  msg: string // if we catch an exception the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_INTERNAL_SERVER_ERROR {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  buy_filled?: boolean
  created_stop_order?: boolean
  created_take_profit_order?: boolean
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_ENTRY_FAILED_TO_FILL {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill
  http_status: 200 // 200: Success... but not 201, so not actually created

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // human readable summary
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string

  // Buy execution
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

export interface TradeAbstractionOpenShortResult_TOO_MANY_REQUESTS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "TOO_MANY_REQUESTS" // exception caught
  http_status: 429

  buy_filled: false // Should rename this entry_filled
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string
  err: any

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: string

  retry_after_seconds: number // can go to Retry-After header
}

interface TradeAbstractionOpenShortResult_UNAUTHORISED {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "UNAUTHORISED" // atm means edge not recognised
  http_status: 403

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_TRADING_IN_ASSET_PROHIBITED {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "TRADING_IN_ASSET_PROHIBITED" // some assets like stable coins we refuse to enter
  http_status: 403

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenShortResult_ALREADY_IN_POSITION {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position
  http_status: 409 // 409: Conflict

  buy_filled: false
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

console.warn(`What http_status do we want for INSUFFICIENT_BALANCE?`) // 200?
interface TradeAbstractionOpenShortResult_INSUFFICIENT_BALANCE {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INSUFFICIENT_BALANCE"
  http_status: 402 // 402: Payment Required, or 200: It was a success really - even if not a 201

  buy_filled: false // rename entered position? or is that additional?
  created_stop_order: false
  created_take_profit_order: false
  stop_order_id?: string | number | undefined
  take_profit_order_id?: string | number | undefined

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

console.warn(`What http_status do we want for ABORTED_FAILED_TO_CREATE_EXIT_ORDERS?`)
interface TradeAbstractionOpenShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS {
  object_type: "TradeAbstractionOpenShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created
  http_status: 418 // TODO: 418: Help What Should I be

  buy_filled: boolean

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number

  created_stop_order: boolean
  stop_order_id?: string | number | undefined

  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenShortResult =
  | TradeAbstractionOpenShortResult_SUCCESS
  | TradeAbstractionOpenShortResult_BAD_INPUTS
  | TradeAbstractionOpenShortResult_UNAUTHORISED
  | TradeAbstractionOpenShortResult_TRADING_IN_ASSET_PROHIBITED
  | TradeAbstractionOpenShortResult_NOT_FOUND
  | TradeAbstractionOpenShortResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenShortResult_INSUFFICIENT_BALANCE
  | TradeAbstractionOpenShortResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenShortResult_TOO_MANY_REQUESTS
  | TradeAbstractionOpenShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
  | TradeAbstractionOpenShortResult_INTERNAL_SERVER_ERROR
