# incidum — личный сайт + админка

## Запуск

```bash
npm install
npm start
```

- Сайт: http://localhost:3000
- Админка: http://localhost:3000/admin  (логин `incidum`, пароль `admin`)

## Смена пароля (обязательно перед публикацией)

```bash
ADMIN_LOGIN=incidum ADMIN_PASSWORD='надёжный-пароль' PORT=3000 npm start
```

## Что можно менять в админке

- никнейм и описание;
- аватарку (фото/GIF/видео);
- фон сайта (фото/GIF/видео).

Всё хранится в папке `data/` (`profile.json` и `uploads/`) — её достаточно бэкапить.

## Хостинг

Нужен сервер с Node.js 18+ (VPS, Render, Railway, Fly.io и т.п.). Статический хостинг
(GitHub Pages, is-a.dev без бэкенда) не подойдёт: админке нужен серверный код.
За nginx/Caddy с HTTPS всё работает как есть (`trust proxy` включён).
