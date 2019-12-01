FROM node

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install

COPY lib /app/lib
COPY service_lib /app/service_lib
COPY binance.js /app/

CMD node ./binance.js 