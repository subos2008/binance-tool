import { DateTime } from "luxon"
import { SpotPositionsQuery } from "../../../../classes/spot/abstractions/spot-positions-query"
import { ServiceLogger } from "../../../../interfaces/logger"
import { Edge70Signal } from "../../../../services/edge70-signals/interfaces/edge70-signal"
import { Edge70SignalCallbacks } from "../../../../services/edge70-signals/interfaces/_internal"
import { BacktesterSpotPostionsTracker } from "../positions-tracker"
import { BacktestTradeExecution } from "./backtest-trade-execution"

export class EdgeSignalsToTradeExecution implements Edge70SignalCallbacks {
  logger: ServiceLogger
  edge: "edge70" | "edge70-backtest"
  positions_tracker: BacktesterSpotPostionsTracker
  trade_execution: BacktestTradeExecution
  spot_positions_query: SpotPositionsQuery

  constructor({
    positions_tracker,
    logger,
    edge,
    trade_execution,
    spot_positions_query,
  }: {
    positions_tracker: BacktesterSpotPostionsTracker
    logger: ServiceLogger
    edge: "edge70" | "edge70-backtest"
    trade_execution: BacktestTradeExecution
    spot_positions_query: SpotPositionsQuery
  }) {
    this.logger = logger
    this.positions_tracker = positions_tracker
    this.edge = edge
    this.trade_execution = trade_execution
    this.spot_positions_query = spot_positions_query
  }

  async init() {}

  async publish(signal: Edge70Signal): Promise<void> {
    let { direction, market_identifier } = signal
    let { base_asset, symbol } = signal.market_identifier
    let { edge } = this
    let tags = { edge, base_asset, direction, symbol }
    let { signal_timestamp_ms, signal_price } = signal.signal

    let date = DateTime.fromMillis(signal_timestamp_ms).toFormat("yyyy LLL dd")
    this.logger.info(tags, `${date}: ${base_asset} ${direction.toUpperCase()}`)

    switch (direction) {
      case "long":
        if (!(await this.spot_positions_query.in_position({ edge, base_asset }))) {
          await this.trade_execution.execute_buy_with_stop({
            signal_timestamp_ms,
            signal_price,
            market_identifier,
          })
          this.trade_execution.add_stop({ market_identifier, signal_price })
        }
        break
      case "short":
        if (await this.spot_positions_query.in_position({ edge, base_asset })) {
          let base_amount = await this.spot_positions_query.exisiting_position_size({ edge, base_asset })
          await this.trade_execution.execute_sell({
            signal_timestamp_ms,
            signal_price,
            market_identifier,
            base_amount,
          })
        }
        break
      default:
        throw new Error(`Unknown direction`)
    }
  }
}
