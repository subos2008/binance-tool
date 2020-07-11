var amqp = require("amqplib/callback_api");
import publish from "../lib/amqp/publish";

publish({test: 'hello world!'}, 'beacon')
