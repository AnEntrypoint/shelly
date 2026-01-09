FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --only=production && npm run build || true

RUN npm rebuild node-pty

COPY . .

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV SHELL_TOKEN=${SHELL_TOKEN:-generated}

CMD ["node", "src/server/index.js"]
