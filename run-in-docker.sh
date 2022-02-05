#!/bin/bash

docker run -it --rm -e TELEGRAM_KEY -e TELEGRAM_CHAT_ID -e REDIS_HOST -e REDIS_PASSWORD -e BINANCE_API_KEY -e BINANCE_API_SECRET -v $PWD/.env:/app/.env  ghcr.io/subos2008/binance-tool/binance-tool:latest ./service.ts
