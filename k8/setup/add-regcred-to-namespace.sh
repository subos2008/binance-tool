#!/bin/bash

source ../../.env

kubectl create secret docker-registry regcred --docker-server=ghcr.io --docker-username=${DOCKER_REGISTRY_USER} --docker-password=${DOCKER_REGISTRY_PASSWORD} --namespace $1 -- $*
