import BigNumber from "bignumber.js"

// TAS level
export interface TradeAbstractionOpenLongCommand {
  object_type: "TradeAbstractionOpenLongCommand"
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: string
  direction: "long"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: string
}
export interface TradeAbstractionOpenFuturesShortCommand {
  object_type: "TradeAbstractionOpenFuturesShortCommand"
  base_asset: string
  quote_asset?: string // added by the TAS before it hits the EE
  edge: string
  direction: "short"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: number
}

export interface TradeAbstractionOpenFuturesShortCommand_OCO_Exit {
  object_type: "TradeAbstractionOpenFuturesShortCommand_OCO_Exit"
  base_asset: string
  quote_asset: string // added by the TAS before it hits the EE
  edge: string
  direction: "short"
  action: "open"
  trigger_price?: string
  signal_timestamp_ms: string
  edge_percentage_stop: BigNumber
  edge_percentage_stop_limit: BigNumber
  edge_percentage_take_profit: BigNumber
  edge_percentage_buy_limit: BigNumber
}

interface TradeAbstractionOpenFuturesShortResult_SUCCESS {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset: string
  edge: string

  status: "SUCCESS" // full or partial entry, all good
  msg: string // human readable summary

  // signal
  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

interface TradeAbstractionOpenFuturesShortResult_INTERNAL_SERVER_ERROR {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "INTERNAL_SERVER_ERROR" // exception caught

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms: string
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenFuturesShortResult_ENTRY_FAILED_TO_FILL {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ENTRY_FAILED_TO_FILL" // limit buy didn't manage to fill

  msg: string // human readable summary
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  // signal
  trigger_price?: string

  // Buy execution
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string
}
interface TradeAbstractionOpenFuturesShortResult_UNAUTHORISED {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "UNAUTHORISED" // atm means edge not recognised

  msg: string // human readable summary
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenFuturesShortResult_TRADING_IN_ASSET_PROHIBITED {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "TRADING_IN_ASSET_PROHIBITED" // some assets like stable coins we refuse to enter

  msg: string
  err: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string
}

interface TradeAbstractionOpenFuturesShortResult_ALREADY_IN_POSITION {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ALREADY_IN_POSITION" // Didn't enter because already in this position

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string
  executed_price?: string // null if nothing bought
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string
}
interface TradeAbstractionOpenFuturesShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS {
  object_type: "TradeAbstractionOpenFuturesShortResult"
  version: 1
  base_asset: string
  quote_asset?: string
  edge: string

  status: "ABORTED_FAILED_TO_CREATE_EXIT_ORDERS" // exited (dumped) the postition as required exit orders couldn't be created

  msg: string // if we catch an exception and return INTERNAL_SERVER_ERROR the message goes here
  err?: any // if we catch an exception and return INTERNAL_SERVER_ERROR the exception goes here

  trigger_price?: string

  // Buy execution
  executed_quote_quantity: string
  executed_base_quantity: string
  executed_price?: string // can be null if nothing bought
  execution_timestamp_ms?: string
  signal_to_execution_slippage_ms?: string

  created_stop_order: boolean
  stop_order_id?: string | number | undefined
  stop_price?: string

  created_take_profit_order: boolean
  take_profit_order_id?: string | number | undefined
  take_profit_price?: string
  oco_order_id?: string | number | undefined
}

export type TradeAbstractionOpenFuturesShortResult =
  | TradeAbstractionOpenFuturesShortResult_SUCCESS
  | TradeAbstractionOpenFuturesShortResult_INTERNAL_SERVER_ERROR
  | TradeAbstractionOpenFuturesShortResult_ENTRY_FAILED_TO_FILL
  | TradeAbstractionOpenFuturesShortResult_UNAUTHORISED
  | TradeAbstractionOpenFuturesShortResult_ALREADY_IN_POSITION
  | TradeAbstractionOpenFuturesShortResult_ABORTED_FAILED_TO_CREATE_EXIT_ORDERS
  | TradeAbstractionOpenFuturesShortResult_TRADING_IN_ASSET_PROHIBITED
