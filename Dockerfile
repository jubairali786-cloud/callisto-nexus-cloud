FROM oven/bun:1.3-slim

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY public ./public
COPY migrations ./migrations
COPY tests ./tests

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "server/index.js"]
