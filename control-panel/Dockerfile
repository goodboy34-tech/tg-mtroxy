FROM node:20-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci

# Копирование исходного кода
COPY tsconfig.json ./
COPY src ./src

# Сборка TypeScript
RUN npm run build

# Удаление dev-зависимостей для уменьшения размера образа
RUN npm prune --production

# Создание директории для базы данных
RUN mkdir -p /app/data

# Запуск бота
CMD ["npm", "start"]
