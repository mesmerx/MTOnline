import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash } from 'crypto';
import db from './db.mjs';

const app = express();
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);

const clientHost = process.env.VITE_CLIENT_HOST || 'localhost';
const clientPort = process.env.VITE_CLIENT_PORT || 5173;
const allowedOrigins = [
  `http://${clientHost}:${clientPort}`,
  `http://localhost:${clientPort}`,
  `http://127.0.0.1:${clientPort}`,
];

// Remover duplicatas
const uniqueOrigins = [...new Set(allowedOrigins)];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requisições sem origin (ex: Postman, mobile apps)
    if (!origin) return callback(null, true);
    
    if (uniqueOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Em desenvolvimento, aceitar qualquer origem localhost/127.0.0.1
      if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Middleware de autenticação
const requireAuth = (req, res, next) => {
  const sessionId = req.cookies.sessionId;
  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE session_id = ?').get(sessionId);
  if (!user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  req.user = user;
  next();
};

// Middleware opcional de autenticação (não retorna erro se não autenticado)
const optionalAuth = (req, res, next) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    const user = db.prepare('SELECT id, username FROM users WHERE session_id = ?').get(sessionId);
    if (user) {
      req.user = user;
    }
  }
  next();
};

// Hash simples de senha (para produção, use bcrypt)
const hashPassword = (password) => {
  return createHash('sha256').update(password).digest('hex');
};

// Rotas de autenticação
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  try {
    const passwordHash = hashPassword(password);
    const sessionId = randomBytes(32).toString('hex');

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, session_id)
      VALUES (?, ?, ?)
    `).run(username, passwordHash, sessionId);

    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
      sameSite: 'lax',
    });

    res.json({ 
      user: { 
        id: result.lastInsertRowid, 
        username 
      } 
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const passwordHash = hashPassword(password);
  const user = db.prepare('SELECT id, username FROM users WHERE username = ? AND password_hash = ?')
    .get(username, passwordHash);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionId = randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET session_id = ? WHERE id = ?').run(sessionId, user.id);

  res.cookie('sessionId', sessionId, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    sameSite: 'lax',
  });

  res.json({ user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_id = NULL WHERE id = ?').run(req.user.id);
  res.clearCookie('sessionId');
  res.json({ success: true });
});

app.get('/api/me', optionalAuth, (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Rotas de decks
app.get('/api/decks', requireAuth, (req, res) => {
  const decks = db.prepare(`
    SELECT id, name, raw_text, entries, is_public, created_at
    FROM decks
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id);

  res.json(decks.map(deck => ({
    id: deck.id,
    name: deck.name,
    rawText: deck.raw_text,
    entries: JSON.parse(deck.entries),
    isPublic: deck.is_public === 1,
    createdAt: deck.created_at,
  })));
});

// Listar decks públicos (não requer autenticação)
app.get('/api/decks/public', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const decks = db.prepare(`
    SELECT d.id, d.name, d.raw_text, d.entries, d.created_at, u.username as author
    FROM decks d
    JOIN users u ON d.user_id = u.id
    WHERE d.is_public = 1
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json(decks.map(deck => ({
    id: deck.id,
    name: deck.name,
    rawText: deck.raw_text,
    entries: JSON.parse(deck.entries),
    createdAt: deck.created_at,
    author: deck.author,
  })));
});

app.post('/api/decks', requireAuth, (req, res) => {
  const { name, entries, rawText, isPublic } = req.body;

  if (!name || !entries || !rawText) {
    return res.status(400).json({ error: 'Name, entries, and rawText are required' });
  }

  const id = randomBytes(16).toString('hex');
  const entriesJson = JSON.stringify(entries);
  const isPublicInt = isPublic === true ? 1 : 0;

  db.prepare(`
    INSERT INTO decks (id, user_id, name, raw_text, entries, is_public)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, name, rawText, entriesJson, isPublicInt);

  res.json({
    id,
    name,
    rawText,
    entries,
    isPublic: isPublic === true,
    createdAt: new Date().toISOString(),
  });
});

app.delete('/api/decks/:id', requireAuth, (req, res) => {
  const { id } = req.params;

  const result = db.prepare(`
    DELETE FROM decks
    WHERE id = ? AND user_id = ?
  `).run(id, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Deck not found' });
  }

  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on 0.0.0.0:${PORT}`);
  console.log(`[api] CORS allowed origins: ${uniqueOrigins.join(', ')}`);
});

