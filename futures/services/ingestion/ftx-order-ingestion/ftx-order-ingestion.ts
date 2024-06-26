// #!./node_modules/.bin/ts-node
// /* eslint-disable no-console */
// 
// import { strict as assert } from 'assert';

// console.log('service starting')

// /**
//  * TODO: send messages to MQ
//  */

// import Sentry from "../../../../lib/sentry"

// Sentry.configureScope(function (scope: any) {
//   scope.setTag("service", "ftx-order-tracker");
// });

// import send_message from  '../../../../lib/telegram' 

// import { Logger } from '../../../../interfaces/logger'
// const LoggerClass = require("../../lib/faux_logger");
// const logger: Logger = new LoggerClass({ silent: false });

// import { BigNumber } from "bignumber.js";
// BigNumber.DEBUG = true; // Prevent NaN
// // Prevent type coercion
// BigNumber.prototype.valueOf = function () {
//   throw Error("BigNumber .valueOf called!");
// };

// process.on("unhandledRejection", error => {
//   logger.error({ err })
//   // send_message(`UnhandledPromiseRejection: ${err}`);
//   Sentry.captureException(err)
// });

// import { FtxWebsocketClient } from "../../../../classes/exchanges/ftx/websocket-client";
// import { FtxOrderExecutionTracker } from "../../../../classes/exchanges/ftx/order_execution_tracker";
// import { FtxOrderCallbacks, FtxWsOrderData } from '../../../../interfaces/exchange/ftx/orders'

// let order_execution_tracker: FtxOrderExecutionTracker | null = null

// class MyOrderCallbacks implements FtxOrderCallbacks {
//   send_message: Function;
//   logger: Logger;

//   constructor({
//     send_message,
//     logger,
//   }: { send_message: (msg: string) => void, logger: Logger }) {
//     assert(logger);
//     this.logger = logger;
//     assert(send_message);
//     this.send_message = send_message;
//   }

//   async order_created(order_id: string, data: FtxWsOrderData): Promise<void> {
//     this.logger.info(data);
//     if (data.type != "market")
//       this.send_message(`Created ${data.type.toUpperCase()} ${data.side.toUpperCase()} order on ${data.market} at ${data.price}.`)
//   }
//   async order_cancelled(order_id: string, data: FtxWsOrderData): Promise<void> {
//     this.send_message(`${data.type.toUpperCase()} ${data.side.toUpperCase()} order on ${data.market} at ${data.price} cancelled.`)
//   }
//   async order_filled(order_id: string, data: FtxWsOrderData): Promise<void> {
//     this.send_message(`${data.type.toUpperCase()} ${data.side.toUpperCase()} order on ${data.market} filled at ${data.avgFillPrice}.`)
//   }
//   async order_filled_or_partially_filled(order_id: string, data: FtxWsOrderData): Promise<void> {
//     // this.send_message(`${data.side} order on ${data.symbol} filled_or_partially_filled at ${data.price}.`)
//   }
// }

// async function main() {
//   if (!process.env.FTX_RO_APIKEY) throw new Error(`FTX_RO_APIKEY not defined`)
//   if (!process.env.FTX_RO_APISECRET) throw new Error(`FTX_RO_APISECRET not defined`)
//   // Prepare a ws connection (connection init is automatic once ws client is instanced)
//   const params = {
//     key: process.env.FTX_RO_APIKEY,
//     secret: process.env.FTX_RO_APISECRET,
//   }

//   const ws = new FtxWebsocketClient(params, logger)

//   // append event listeners
//   ws.on("response", (msg) => logger.info("response: ", msg))
//   ws.on("error", (msg) => logger.error("err: ", msg))
//   ws.on("update", (msg) => logger.info("update: ", msg))

//   const execSync = require("child_process").execSync
//   execSync("date -u")

//   let order_callbacks = new MyOrderCallbacks({ logger, send_message })

//   order_execution_tracker = new FtxOrderExecutionTracker({
//     ws,
//     send_message,
//     logger,
//     order_callbacks
//   })

//   order_execution_tracker.main().catch(error => {
//     Sentry.captureException(err)
//     if (err.name && err.name === "FetchError") {
//       logger.error(
//         `${err.name}: Likely unable to connect to FTX and/or Telegram: ${err}`
//       );
//     } else {
//       logger.error(`Error in main loop: ${err}`);
//       logger.error({ err });
//       logger.error(`Error in main loop: ${err.stack}`);
//       send_message(`Error in main loop: ${err}`);
//     }
//     soft_exit(1);
//   }).then(() => { logger.info('order_execution_tracker.main() returned.') });
// }

// // TODO: exceptions / sentry
// main().catch(error => {
//   Sentry.captureException(err)
//   logger.error(`Error in main loop: ${err}`);
//   logger.error({ err });
//   logger.error(`Error in main loop: ${err.stack}`);
//   soft_exit(1);
// });

// // Note this method returns!
// // Shuts down everything that's keeping us alive so we exit
// function soft_exit(exit_code: number | null = null) {
//   logger.warn(`soft_exit called, exit_code: ${exit_code}`)
//   if (exit_code) logger.warn(`soft_exit called with non-zero exit_code: ${exit_code}`);
//   if (exit_code) process.exitCode = exit_code;
//   if (order_execution_tracker) order_execution_tracker.shutdown_streams();
//   // setTimeout(dump_keepalive, 10000); // note enabling this debug line will delay exit until it executes
// }
