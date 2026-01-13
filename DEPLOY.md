# Инструкция по деплою Backend

## Подготовка к деплою

1. **Установите зависимости:**
   ```bash
   npm install
   ```

2. **Соберите проект:**
   ```bash
   npm run build
   ```

3. **Настройте переменные окружения:**
   - Скопируйте `.env.example` в `.env`
   - Заполните необходимые переменные:
     - `API_KEY` - установите безопасный API ключ
     - `FRONTEND_URL` - URL вашего фронтенда
     - `ALLOWED_ORIGINS` - разрешенные origins для CORS

## Деплой на Render.com

1. **Создайте новый Web Service на Render:**
   - Подключите ваш Git репозиторий
   - Выберите branch (обычно `main` или `master`)

2. **Настройки Build:**
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `node dist/server.js`

3. **Настройте Environment Variables:**
   - `PORT` - Render автоматически устанавливает, но можно указать явно
   - `API_KEY` - ваш API ключ
   - `FRONTEND_URL` - URL фронтенда
   - `ALLOWED_ORIGINS` - разрешенные origins
   - `NODE_ENV=production`

4. **Важно:**
   - Убедитесь, что папка `data` существует и содержит необходимые файлы
   - Для production рекомендуется использовать внешнее хранилище для данных

## Деплой на Heroku

1. **Установите Heroku CLI**

2. **Создайте приложение:**
   ```bash
   heroku create your-app-name
   ```

3. **Настройте переменные окружения:**
   ```bash
   heroku config:set API_KEY=your-api-key
   heroku config:set FRONTEND_URL=https://your-frontend-url.com
   heroku config:set ALLOWED_ORIGINS=https://your-frontend-url.com
   heroku config:set NODE_ENV=production
   ```

4. **Создайте Procfile:**
   ```
   web: node dist/server.js
   ```

5. **Деплой:**
   ```bash
   git push heroku main
   ```

## Деплой на VPS (Ubuntu/Debian)

1. **Установите Node.js и npm**

2. **Клонируйте репозиторий:**
   ```bash
   git clone <your-repo-url>
   cd config_tool_backend
   ```

3. **Установите зависимости и соберите:**
   ```bash
   npm install
   npm run build
   ```

4. **Настройте переменные окружения:**
   ```bash
   cp .env.example .env
   nano .env  # Отредактируйте файл
   ```

5. **Используйте PM2 для управления процессом:**
   ```bash
   npm install -g pm2
   pm2 start dist/server.js --name "ddive-backend"
   pm2 save
   pm2 startup
   ```

6. **Настройте Nginx как reverse proxy:**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

## Проверка работоспособности

После деплоя проверьте:
- Health check: `GET https://your-backend-url.com/health`
- API доступен: `GET https://your-backend-url.com/api/publishers` (с заголовком `x-api-key`)
