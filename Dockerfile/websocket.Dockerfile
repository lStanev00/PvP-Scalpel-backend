FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache libc6-compat \
    && apk add --no-cache --virtual .build-deps python3 make g++

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force \
    && apk del .build-deps

COPY src ./src

EXPOSE 4001

USER node

CMD ["npm", "run", "startWS"]
