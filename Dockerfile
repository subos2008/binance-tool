FROM node

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install

COPY lib service_lib binance.js /app/

CMD node ./binance.js 