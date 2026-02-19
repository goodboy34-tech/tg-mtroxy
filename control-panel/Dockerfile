FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src

RUN npm run build

ENV NODE_ENV=production

VOLUME ["/app/data"]

CMD ["node", "dist/index.js"]
