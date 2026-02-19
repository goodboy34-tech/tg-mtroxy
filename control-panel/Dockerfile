FROM node:22-alpine

WORKDIR /app

COPY package.json tsconfig.json ./
# Создаем package-lock.json в Linux окружении для правильной синхронизации
RUN npm install --package-lock-only

COPY src ./src

RUN npm ci && npm run build

ENV NODE_ENV=production

VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
