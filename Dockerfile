# Multi-stage container for Glama Firecracker microVM & Model Context Protocol (MCP) execution
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build:cli

# Production runtime stage: zero devDependencies, self-contained compiled engine
FROM node:22-alpine
WORKDIR /app

COPY package.json ./
COPY cli.js ./
COPY --from=builder /app/dist-cli ./dist-cli

ENV NODE_ENV=production
ENV AMBIT_MCP_PROFILE=agent

ENTRYPOINT ["node", "--experimental-sqlite", "cli.js", "mcp"]
