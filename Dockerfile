FROM node

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile

COPY lib /app/lib
COPY classes /app/classes
COPY service_lib /app/service_lib
COPY service.js /app/
COPY services /app/services
COPY interfaces /app/interfaces
COPY test /app/test
COPY chai-bignumber.d.ts /app/chai-bignumber.d.ts

CMD node ./service.js
