#!/bin/bash

docker-compose --file docker-compose.test.yml build && docker-compose --file docker-compose.test.yml run sut
