FROM node

RUN mkdir -p /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn install

COPY lib /app/lib
COPY classes /app/classes
COPY service_lib /app/service_lib
COPY service.js /app/

CMD node ./service.js 