FROM rust:1.97.1-alpine3.24 AS media-recovery-builder

WORKDIR /build/media-recovery

RUN apk add --no-cache \
        build-base \
        clang-dev \
        ffmpeg-dev \
        pkgconf

COPY native/media-recovery/Cargo.toml native/media-recovery/Cargo.lock ./
COPY native/media-recovery/src ./src

RUN cargo test --locked \
    && cargo build --release --locked

FROM node:22-alpine3.24

ENV NODE_ENV=production \
    STORAGE_LOCAL_ENDPOINT=http://minio:4010

WORKDIR /app

RUN apk add --no-cache \
        libc6-compat \
        clamav \
        clamav-daemon \
        clamav-scanner \
        ffmpeg \
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

COPY --chown=node:node src ./src
COPY --chown=node:node docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
COPY --from=media-recovery-builder \
    /build/media-recovery/target/release/media-recovery \
    /usr/local/bin/media-recovery

RUN chmod +x /usr/local/bin/worker-entrypoint.sh \
    && chmod 755 /usr/local/bin/media-recovery \
    && mkdir -p /run/clamav /var/lib/clamav /var/log/clamav /mnt/work \
    && chown -R clamav:clamav /run/clamav /var/lib/clamav /var/log/clamav \
    && chown node:node /mnt/work \
    && chmod 755 /run/clamav

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/worker-entrypoint.sh"]

CMD ["npm", "run", "startWorker"]
