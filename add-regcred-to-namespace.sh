#!/bin/bash

source .env

kubectl create secret docker-registry regcred --docker-server=docker.pkg.github.com --docker-username=${DOCKER_REGISTRY_USER} --docker-password=${DOCKER_REGISTRY_PASSWORD} --namespace $1 -- $*