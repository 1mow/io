const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
// Логин/пароль по умолчанию: incidum / admin. Для продакшена задайте свои:
//   ADMIN_LOGIN=... ADMIN_PASSWORD=... node server.js
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'incidum';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sosi';

const DATA = path.join(__dirname, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const CONFIG = path.join(DATA, 'profile.json');
fs.mkdirSync(UPLOADS, { recursive: true });

const DEFAULTS = {
  nickname: 'incidum',
  description:
    'OSINT-аналитик с 3-летним стажем. Социальная инженерия, разработка, технологии.\n' +
    'Нахожу связи там, где другие видят шум. Открытые источники — моё оружие, код — мой инструмент.',
  avatar: null,
  background: null,
};

function loadProfile() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveProfile(p) {
  fs.writeFileSync(CONFIG, JSON.stringify(p, null, 2));
}

// ---------- auth ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

const sessions = new Map(); // sid -> expiresAt
const SESSION_TTL = 1000 * 60 * 60 * 12; // 12 часов
const attempts = new Map(); // ip -> { count, until }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function isAuthed(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (exp < Date.now()) {
    sessions.delete(sid);
    return false;
  }
  return true;
}
function requireAuth(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Не авторизован' });
  next();
}

app.use(express.json({ limit: '100kb' }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const rec = attempts.get(ip) || { count: 0, until: 0 };
  if (rec.until > Date.now()) {
    return res.status(429).json({ error: 'Слишком много попыток. Подождите несколько минут.' });
  }
  const { login = '', password = '' } = req.body || {};
  const ok = safeEqual(login, ADMIN_LOGIN) && safeEqual(password, ADMIN_PASSWORD);
  if (!ok) {
    rec.count += 1;
    if (rec.count >= 5) {
      rec.count = 0;
      rec.until = Date.now() + 15 * 60 * 1000;
    }
    attempts.set(ip, rec);
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  attempts.delete(ip);
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + SESSION_TTL);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ authed: isAuthed(req) }));

// ---------- profile ----------
app.get('/api/profile', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(loadProfile());
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { nickname, description } = req.body || {};
  const p = loadProfile();
  if (typeof nickname === 'string') {
    const n = nickname.trim();
    if (!n || n.length > 32) return res.status(400).json({ error: 'Никнейм: от 1 до 32 символов' });
    p.nickname = n;
  }
  if (typeof description === 'string') {
    if (description.length > 1500) return res.status(400).json({ error: 'Описание: максимум 1500 символов' });
    p.description = description;
  }
  saveProfile(p);
  res.json(p);
});

// ---------- uploads ----------
const TYPES = {
  'image/jpeg': ['.jpg', 'image'],
  'image/png': ['.png', 'image'],
  'image/webp': ['.webp', 'image'],
  'image/gif': ['.gif', 'image'],
  'image/avif': ['.avif', 'image'],
  'video/mp4': ['.mp4', 'video'],
  'video/webm': ['.webm', 'video'],
  'video/ogg': ['.ogv', 'video'],
  'video/quicktime': ['.mov', 'video'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => {
      const ext = (TYPES[file.mimetype] || ['.bin'])[0];
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!TYPES[file.mimetype]) return cb(new Error('Формат не поддерживается'));
    cb(null, true);
  },
});

const KINDS = ['avatar', 'background'];

function removeFile(entry) {
  if (!entry || !entry.url) return;
  const f = path.join(UPLOADS, path.basename(entry.url));
  fs.unlink(f, () => {});
}

app.post(
  '/api/upload/:kind',
  requireAuth,
  (req, res, next) => {
    if (!KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'Неизвестный тип' });
    next();
  },
  (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой (макс. 300 МБ)' : err.message;
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
      const kind = req.params.kind;
      if (kind === 'avatar' && req.file.size > 30 * 1024 * 1024) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Аватарка: максимум 30 МБ' });
      }
      const p = loadProfile();
      removeFile(p[kind]);
      p[kind] = { url: '/uploads/' + req.file.filename, type: TYPES[req.file.mimetype][1] };
      saveProfile(p);
      res.json(p);
    });
  }
);

app.delete('/api/upload/:kind', requireAuth, (req, res) => {
  const kind = req.params.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Неизвестный тип' });
  const p = loadProfile();
  removeFile(p[kind]);
  p[kind] = null;
  saveProfile(p);
  res.json(p);
});

// ---------- static ----------
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d', immutable: true }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/', (req, res) => res.redirect('/admin'));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Сайт: http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
  if (ADMIN_PASSWORD === 'admin') {
    console.log('Внимание: используется пароль по умолчанию. Задайте ADMIN_PASSWORD перед публикацией.');
  }
});
