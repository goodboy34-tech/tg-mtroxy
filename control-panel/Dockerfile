FROM node:20-alpine

WORKDIR /app

# Установка зависимостей
COPY package*.json ./
RUN npm ci --only=production

# Копирование исходного кода
COPY tsconfig.json ./
COPY src ./src

# Сборка TypeScript
RUN npm run build

# Создание директории для базы данных
RUN mkdir -p /app/data

# Запуск бота
CMD ["npm", "start"]
