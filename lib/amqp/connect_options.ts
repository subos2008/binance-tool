// const splitca = require("split-ca");

import { strict as assert } from 'assert';

const amqp_server = process.env.AMQP_HOST // || "localhost";
const vhost = process.env.AMQP_VHOST // || "binance-tool";
const amqp_user = process.env.AMQP_USER // || "binance-tool";
const amqp_password = process.env.AMQP_PASSWORD;
const protocol = process.env.AMQP_PROTOCOL // || "amqps";

const Logger = require("../../lib/faux_logger");
// Initial logger, we re-create it below once we have the trade_id
var logger = new Logger({ silent: false });

assert(protocol)
assert(amqp_password)
assert(amqp_user)
assert(vhost)
assert(amqp_server)

if (protocol !== 'amqps') {
  logger.warn(`Connection to AMQP Server ${amqp_server} is not using https: ${protocol}`)
}

const port = 5672

const connection_options = {
  // TODO: add SSL: http://www.squaremobius.net/amqp.node/ssl.html
  protocol, // Don't be a fool, encrypt traffic
  port,
  hostname: amqp_server,
  username: amqp_user,
  password: amqp_password,
  locale: "en_US",
  vhost,
  // ca: splitca("./ca-certificates.crt")
}

logger.info(`AMQP hostname: ${amqp_server} port: ${port} protocol: ${protocol}`)

export default connection_options;
