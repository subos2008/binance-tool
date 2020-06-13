#!/bin/bash

docker-compose --file docker-compose.cluster.yml build && docker-compose --file docker-compose.cluster.yml up
