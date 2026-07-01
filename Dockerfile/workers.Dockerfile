FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

RUN apk add --no-cache \
        libc6-compat \
        clamav \
        clamav-daemon \
        clamav-scanner \
        freshclam \
        su-exec \
        tini \
    && apk add --no-cache --virtual .build-deps \
        python3 \
        make \
        g++

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force \
    && apk del .build-deps

COPY src ./src
COPY docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh

RUN chmod +x /usr/local/bin/worker-entrypoint.sh \
    && mkdir -p /run/clamav /var/lib/clamav /var/log/clamav \
    && chown -R node:node /app \
    && chmod 777 /run/clamav

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/worker-entrypoint.sh"]

CMD ["npm", "run", "startWorker"]