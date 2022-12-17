# crypto.randomUUID needs 15+, even numbers are LTS
FROM node:16.14

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile

COPY lib /app/lib
COPY classes /app/classes
# COPY service_lib /app/service_lib
# COPY service.ts /app/
COPY services /app/services
COPY interfaces /app/interfaces
COPY observability /app/observability
COPY types /app/types
COPY test /app/test
COPY tests /app/tests
COPY events /app/events
COPY edges /app/edges
# COPY services-test-rig /app/services-test-rig
COPY chai-bignumber.d.ts /app/chai-bignumber.d.ts
COPY tsconfig.json /app/tsconfig.json
COPY config.ts /app/config.ts

RUN ./node_modules/.bin/tsc

# CMD ./service.ts
