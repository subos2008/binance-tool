export interface TradeAbstractionOpenLongCommand {
  object_type: "TradeAbstractionOpenLongCommand"
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
}


interface TradeAbstractionOpenLongResult_SUCCESS {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary
  http_status: 201 // 201: Created

  // signal
  trigger_price?: string

  // Buy execution
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

interface TradeAbstractionOpenLongResult_BAD_INPUTS {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset?: string
  quote_asset?: string
  edge?: string
  direction?: string
  action?: string
  
  status: "BAD_INPUTS" // exception caught
  http_status: 400
  
  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here
  
  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenLongResult_INTERNAL_SERVER_ERROR {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INTERNAL_SERVER_ERROR" // exception caught
  http_status: 500

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: number
  signal_to_execution_slippage_ms?: number
}
interface TradeAbstractionOpenLongResult_ENTRY_FAILED_TO_FILL {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill
  http_status: 200 // 200: Success... but not 201, so not actually created

  msg: string // human readable summary
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string

  // Buy execution
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}
interface TradeAbstractionOpenLongResult_UNAUTHORISED {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "UNAUTHORISED" // atm means edge not recognised
  http_status: 403

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenLongResult_TRADING_IN_ASSET_PROHIBITED {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "TRADING_IN_ASSET_PROHIBITED" // some assets like stable coins we refuse to enter
  http_status: 403 // Double check this is correct when online sometime

  msg: string
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

interface TradeAbstractionOpenLongResult_ALREADY_IN_POSITION {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position
  http_status: 409 // 409: Conflict

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

console.warn(`What http_status do we want for INSUFFICIENT_BALANCE?`) // 200?
interface TradeAbstractionOpenLongResult_INSUFFICIENT_BALANCE {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INSUFFICIENT_BALANCE"
  http_status: 402 // 402: Payment Required, or 200: It was a success really - even if not a 201

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: number
  signal_to_execution_slippage_ms?: number
}

console.warn(`What http_status do we want for ABORTED_FAILED_TO_CREATE_EXIT_ORDERS?`)
interface TradeAbstractionOpenLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS {
  object_type: "TradeAbstractionOpenLongResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created
  http_status: 418 // TODO: 418: Help What Should I be

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: number // TODO: should all these be optional?
  signal_to_execution_slippage_ms?: number

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenLongResult =
  | TradeAbstractionOpenLongResult_SUCCESS
  | TradeAbstractionOpenLongResult_BAD_INPUTS
  | TradeAbstractionOpenLongResult_UNAUTHORISED
  | TradeAbstractionOpenLongResult_TRADING_IN_ASSET_PROHIBITED
  | TradeAbstractionOpenLongResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenLongResult_INSUFFICIENT_BALANCE
  | TradeAbstractionOpenLongResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenLongResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
  | TradeAbstractionOpenLongResult_INTERNAL_SERVER_ERROR
