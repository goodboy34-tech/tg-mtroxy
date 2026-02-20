FROM node:22-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости (включая dev для сборки)
COPY package.json package-lock.json ./
# Используем npm install, чтобы не падать из‑за рассинхрона package-lock.json при обновлениях
RUN npm install

# Копируем исходники и tsconfig.json
COPY src ./src
COPY tsconfig.json ./

# Компилируем TypeScript
RUN npm run build

# Удаляем dev зависимости и исходники для уменьшения размера образа
RUN npm install --omit=dev
RUN rm -rf src tsconfig.json

EXPOSE 8080
CMD ["node", "dist/api.js"]
