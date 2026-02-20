FROM node:22-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости (включая dev для сборки)
COPY package.json package-lock.json ./
RUN npm ci

# Копируем исходники и tsconfig.json
COPY src ./src
COPY tsconfig.json ./

# Компилируем TypeScript
RUN npm run build

# Удаляем dev зависимости и исходники для уменьшения размера образа
RUN npm ci --omit=dev
RUN rm -rf src tsconfig.json

EXPOSE 8080
CMD ["node", "dist/api.js"]
