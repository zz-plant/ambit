# Container configuration for Glama Firecracker microVM & Model Context Protocol (MCP) execution
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build:cli

ENV NODE_ENV=production
ENV AMBIT_MCP_PROFILE=agent

ENTRYPOINT ["node", "--experimental-sqlite", "cli.js", "mcp"]
