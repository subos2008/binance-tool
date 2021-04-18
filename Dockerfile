FROM node

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install --frozen-lockfile

COPY lib /app/lib
COPY classes /app/classes
COPY service_lib /app/service_lib
COPY service.ts /app/
COPY services /app/services
COPY interfaces /app/interfaces
COPY types /app/types
COPY test /app/test
# COPY services-test-rig /app/services-test-rig
COPY chai-bignumber.d.ts /app/chai-bignumber.d.ts
COPY tsconfig.json /app/tsconfig.json

CMD ./service.ts
