FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY reference ./reference
RUN npm run build
COPY docker/git-askpass.sh /usr/local/bin/git-askpass
RUN chmod 755 /usr/local/bin/git-askpass
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/app/data GIT_ASKPASS=/usr/local/bin/git-askpass
EXPOSE 3000
CMD ["npm", "start"]
