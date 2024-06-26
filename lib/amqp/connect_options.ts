// const splitca = require("split-ca");

import { Options } from "amqplib"
import { strict as assert } from "assert"

const amqp_server = process.env.AMQP_HOST // || "localhost";
const vhost = process.env.AMQP_VHOST // || "binance-tool";
const amqp_user = process.env.AMQP_USER // || "binance-tool";
const amqp_password = process.env.AMQP_PASSWORD
const protocol = process.env.AMQP_PROTOCOL // || "amqps";

assert(protocol)
assert(amqp_password)
assert(amqp_user)
assert(vhost)
assert(amqp_server)

// if (protocol !== 'amqps') {
//   logger.warn(`Connection to AMQP Server ${amqp_server} is not using https: ${protocol}`)
// }

const port = 5672

const connection_options: Options.Connect = {
  // TODO: add SSL: http://www.squaremobius.net/amqp.node/ssl.html
  protocol, // Don't be a fool, encrypt traffic
  port,
  hostname: amqp_server,
  username: amqp_user,
  password: amqp_password,
  locale: "en_US",
  vhost,
  heartbeat: 20, // Values within the 5 to 20 seconds range are optimal for most environments.
  // ca: splitca("./ca-certificates.crt")
}

export default connection_options
