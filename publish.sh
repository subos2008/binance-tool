#!/bin/bash

source .env

set -xe 

# $(aws ecr get-login --no-include-email --region eu-central-1)
docker login ghcr.io -u $DOCKER_REGISTRY_USER -p $DOCKER_REGISTRY_PASSWORD

docker build -t binance-tool:latest .
docker tag binance-tool:latest ${DOCKER_REGISTRY}:latest
docker push ${DOCKER_REGISTRY}:latest
