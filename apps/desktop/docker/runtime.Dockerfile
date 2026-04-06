FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends bash ca-certificates git procps \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && npm install -g bun@1.3.1

WORKDIR /workspace
