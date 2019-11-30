#!/bin/bash

set -xe 

source .env

# $(aws ecr get-login --no-include-email --region eu-central-1)
docker login docker.pkg.github.com -u $DOCKER_REGISTRY_USER -p $DOCKER_REGISTRY_PASSWORD

docker build -t binance-tool:latest .
docker tag binance-tool:latest ${DOCKER_REGISTRY}:latest
docker push ${DOCKER_REGISTRY}:latest
