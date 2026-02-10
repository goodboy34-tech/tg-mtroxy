# Node Agent Dockerfile
FROM node:20-alpine

# Установка зависимостей для работы с Docker
RUN apk add --no-cache docker-cli curl bash

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci

# Копируем исходный код
COPY . .

# Компилируем TypeScript
RUN npm run build

# Удаление dev-зависимостей для уменьшения размера образа
RUN npm prune --production

# Создаем директорию для данных
RUN mkdir -p /app/data

# Порт API
EXPOSE 8080

# Запуск API сервера
CMD ["node", "dist/api.js"]
