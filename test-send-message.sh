#!/bin/bash

# ./proxy-rabbitmq.sh
source .env
/usr/local/opt/rabbitmq/sbin/rabbitmqadmin -u "$AMQP_USER" -p "$AMQP_PASSWORD" -V $AMQP_VHOST publish exchange=binance-tool routing_key=SendMessage payload="{ \"object_type\":\"SendMessage\", \"service_name\": \"ryan_test\", \"msg\": \"Hello World!\", \"tags\": {}}"
