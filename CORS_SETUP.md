# Настройка CORS для GitHub Pages

## Текущая конфигурация

Backend настроен для работы с несколькими источниками:

1. **Локальная разработка**: `http://localhost:3000`
2. **Production**: Настраивается через переменную окружения `ALLOWED_ORIGINS`

## Настройка на Render

### Вариант 1: Через переменные окружения (рекомендуется)

1. Зайдите в настройки вашего сервиса на Render
2. Перейдите в раздел "Environment"
3. Добавьте переменную:
   - **Key**: `ALLOWED_ORIGINS`
   - **Value**: `https://your-username.github.io,https://your-username.github.io/repository-name`
   
   Пример:
   ```
   https://alex-manis.github.io,https://alex-manis.github.io/ddive_config_tool
   ```

4. Сохраните и перезапустите сервис

### Вариант 2: Изменить код напрямую

Если вы знаете точный URL вашего GitHub Pages, можете добавить его в `server.ts`:

```typescript
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        "http://localhost:3000",
        "https://localhost:3000",
        "https://your-username.github.io",  // Добавьте сюда
        "https://your-username.github.io/repository-name",  // И сюда, если нужно
      ];
```

## Проверка CORS

После настройки проверьте:

1. Откройте консоль браузера на GitHub Pages
2. Попробуйте сделать запрос к API
3. Если видите CORS ошибку, проверьте:
   - Правильно ли указан URL в `ALLOWED_ORIGINS`
   - Перезапущен ли сервис на Render
   - Нет ли опечаток в URL

## Для разработки

В режиме разработки (`NODE_ENV !== 'production'`) все источники разрешены для удобства.

