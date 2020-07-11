// import { strict as assert } from 'assert';

// import amqp from "amqplib/callback_api";
// const hash_image = require("../../../cdn/store_image");

// const exchange = process.env.AMQP_EXCHANGE;
// assert(exchange)

// const messages: any[] = []


// import options from "../lib/amqp/connect_options";

// const { promisify } = require("util");
// const connectAsync = promisify(amqp.connect).bind(amqp);

// async function main(queue_route = 'beacon') {
//   const connection = await connectAsync(options)

//   const createChannelAsync = promisify(connection.createChannel).bind(connection);
//   const channel = await createChannelAsync()

//   channel.assertExchange(exchange, "topic", { durable: false });

//   const assertQueueAsync = promisify(channel.assertQueue).bind(channel);
//   const q = await assertQueueAsync("", { exclusive: true })

//   console.log(" [*] Waiting for new messages. To exit press CTRL+C");

//   channel.bindQueue(q.queue, exchange, queue_route);
//   channel.prefetch(1);

//   async function message_processor(msg: any) {
//     console.log(
//       " [x] %s: '%s'",
//       msg.fields.routingKey,
//       msg.content.toString()
//     );
//     const message = JSON.parse(msg.content.toString());
//     message_processor(message)
//     channel.ack(msg);
//     messages.push(message)
//   }

//   channel.consume(q.queue, message_processor, { noAck: false });
// }
