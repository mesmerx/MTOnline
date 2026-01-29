import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash, createHmac } from 'crypto';
import db from './db.mjs';

const app = express();
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);

const clientHost = process.env.VITE_CLIENT_HOST || 'localhost';
const clientPort = process.env.VITE_CLIENT_PORT || 5173;
const allowedOrigins = [
  `http://${clientHost}:${clientPort}`,
  `http://localhost:${clientPort}`,
  `http://127.0.0.1:${clientPort}`,
  'https://mto.mesmer.tv',
  'http://mto.mesmer.tv',
  'https://www.mto.mesmer.tv',
  'http://www.mto.mesmer.tv',
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

const ensureCardsAvailable = () => {
  const row = db.prepare('SELECT 1 FROM cards LIMIT 1').get();
  return !!row;
};

const CARD_FIELDS = `
  id,
  name,
  name_normalized,
  type_line,
  mana_cost,
  oracle_text,
  image_url,
  back_image_url,
  set_name,
  set_code,
  collector_number
`;

const selectExactName = db.prepare(`
  SELECT ${CARD_FIELDS}
  FROM cards
  WHERE name_normalized = ?
  ORDER BY set_code, collector_number
  LIMIT 25
`);

const selectExactNameAndSet = db.prepare(`
  SELECT ${CARD_FIELDS}
  FROM cards
  WHERE name_normalized = ?
    AND set_code = ?
  ORDER BY collector_number
  LIMIT 25
`);

const selectLikeName = db.prepare(`
  SELECT ${CARD_FIELDS}
  FROM cards
  WHERE name_normalized LIKE ?
  ORDER BY INSTR(name_normalized, ?) ASC, name ASC
  LIMIT 100
`);

const selectLikeNameAndSet = db.prepare(`
  SELECT ${CARD_FIELDS}
  FROM cards
  WHERE name_normalized LIKE ?
    AND set_code = ?
  ORDER BY INSTR(name_normalized, ?) ASC, collector_number
  LIMIT 100
`);

const selectBySetCollector = db.prepare(`
  SELECT ${CARD_FIELDS}
  FROM cards
  WHERE set_code = ?
    AND collector_number = ?
  LIMIT 1
`);

const cardRowToResult = (row) => ({
  name: row.name,
  oracleText: row.oracle_text || null,
  manaCost: row.mana_cost || null,
  typeLine: row.type_line || null,
  imageUrl: row.image_url || undefined,
  backImageUrl: row.back_image_url || undefined,
  setName: row.set_name || row.set_code || undefined,
});

function fuzzyMatch(query, target) {
  const queryLower = query.toLowerCase();
  const targetLower = target.toLowerCase();
  
  // Match exato
  if (targetLower === queryLower) return 100;
  
  // Começa com a query
  if (targetLower.startsWith(queryLower)) return 90;
  
  // Contém a query
  if (targetLower.includes(queryLower)) return 70;
  
  // Verifica palavras individuais
  const queryWords = queryLower.split(/\s+/);
  const targetWords = targetLower.split(/\s+/);
  let matches = 0;
  for (const qWord of queryWords) {
    if (targetWords.some(tWord => tWord.includes(qWord) || qWord.includes(tWord))) {
      matches++;
    }
  }
  if (matches > 0) {
    return (matches / queryWords.length) * 50;
  }
  
  return 0;
}

const escapeLikePattern = (value) => value.replace(/[%_]/g, '\\$&');

const findCardByName = (queryLower, setLower) => {
  const normalizedSet = setLower ? setLower.toLowerCase() : null;
  const exactRows = normalizedSet
    ? selectExactNameAndSet.all(queryLower, normalizedSet)
    : selectExactName.all(queryLower);
  if (exactRows.length > 0) {
    return exactRows[0];
  }
  
  const pattern = `%${escapeLikePattern(queryLower)}%`;
  const likeRows = normalizedSet
    ? selectLikeNameAndSet.all(pattern, normalizedSet, queryLower)
    : selectLikeName.all(pattern, queryLower);
  
  if (likeRows.length === 0) {
    return null;
  }
  
  const scored = likeRows
    .map((row) => ({
      row,
      score: fuzzyMatch(queryLower, row.name_normalized || ''),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  
  if (scored.length > 0) {
    return scored[0].row;
  }
  
  return likeRows[0];
};

// Health check endpoint
app.get('/health', (req, res) => {
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
app.post('/register', (req, res) => {
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

app.post('/login', (req, res) => {
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

app.post('/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET session_id = NULL WHERE id = ?').run(req.user.id);
  res.clearCookie('sessionId');
  res.json({ success: true });
});

app.get('/me', optionalAuth, (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Rotas de decks
app.get('/decks', requireAuth, (req, res) => {
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
app.get('/decks/public', (req, res) => {
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

app.post('/decks', requireAuth, (req, res) => {
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

app.delete('/decks/:id', requireAuth, (req, res) => {
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

// Rotas de cartas (busca local)
app.get('/cards/search', (req, res) => {
  if (!ensureCardsAvailable()) {
    return res.status(503).json({ error: 'Cards data not loaded. Run: node server/download-cards.mjs' });
  }

  const { name, set: setCode } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'name parameter is required' });
  }

  const queryLower = name.toLowerCase().trim();
  const setLower = setCode ? setCode.toLowerCase() : null;
  
  const card = findCardByName(queryLower, setLower);
  if (card) {
    return res.json(cardRowToResult(card));
  }
  
  res.status(404).json({ error: 'Card not found' });
});

app.get('/cards/:setCode/:collectorNumber', (req, res) => {
  if (!ensureCardsAvailable()) {
    return res.status(503).json({ error: 'Cards data not loaded. Run: node server/download-cards.mjs' });
  }

  const { setCode, collectorNumber } = req.params;
  
  const card = selectBySetCollector.get(setCode.toLowerCase(), collectorNumber);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }
  
  res.json(cardRowToResult(card));
});

// Endpoint batch para buscar múltiplas cartas de uma vez
app.post('/cards/batch', (req, res) => {
  if (!ensureCardsAvailable()) {
    return res.status(503).json({ error: 'Cards data not loaded. Run: node server/download-cards.mjs' });
  }

  const { cards } = req.body;
  
  if (!Array.isArray(cards)) {
    return res.status(400).json({ error: 'cards must be an array' });
  }

  const results = cards.map((request) => {
    const { name, setCode, collectorNumber } = request;
    
    if (!name && (!setCode || !collectorNumber)) {
      return { error: 'name or (setCode and collectorNumber) required' };
    }

    let cardRow = null;

    if (setCode && collectorNumber) {
      cardRow = selectBySetCollector.get(setCode.toLowerCase(), collectorNumber) || null;
    }

    if (!cardRow && name) {
      cardRow = findCardByName(name.toLowerCase().trim(), setCode ? setCode.toLowerCase() : null);
    }

    if (!cardRow) {
      return { error: 'Card not found', request };
    }

    return cardRowToResult(cardRow);
  });

  res.json(results);
});

// Endpoint para gerar credenciais TURN
app.get('/api/turn-credentials', (req, res) => {
  const TURN_SECRET = process.env.TURN_SECRET;
  
  if (!TURN_SECRET) {
    console.error('[TURN] TURN_SECRET não configurado no .env');
    return res.status(500).json({ error: 'TURN_SECRET not configured' });
  }
  
  const ttl = 60 * 60; // 1 hora
  const username = Math.floor(Date.now() / 1000) + ttl;

  const password = createHmac('sha1', TURN_SECRET)
    .update(username.toString())
    .digest('base64');

  const response = {
    urls: [
      'turn:turn.mesmer.tv:3478',
      'turns:turn.mesmer.tv:5349'
    ],
    username: username.toString(),
    credential: password
  };

  console.log('[TURN API] Retornando credenciais:', {
    username: response.username,
    urls: response.urls
  });

  res.json(response);
});

// Salvar estado do board por roomId
app.post('/api/rooms/:roomId/state', (req, res) => {
  const { roomId } = req.params;
  const { board, counters, players, cemeteryPositions, libraryPositions } = req.body;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  try {
    const state = {
      board: board || [],
      counters: counters || [],
      players: players || [],
      cemeteryPositions: cemeteryPositions || {},
      libraryPositions: libraryPositions || {},
    };

    const stateJson = JSON.stringify(state);

    db.prepare(`
      INSERT INTO rooms (room_id, board_state, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(room_id) DO UPDATE SET
        board_state = excluded.board_state,
        updated_at = CURRENT_TIMESTAMP
    `).run(roomId, stateJson);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Erro ao salvar estado do room:', error);
    res.status(500).json({ error: 'Failed to save room state' });
  }
});

// Salvar evento de uma sala (event sourcing)
app.post('/api/rooms/:roomId/events', (req, res) => {
  const { roomId } = req.params;
  const { eventType, eventData, playerId, playerName } = req.body;

  if (!roomId || !eventType || !eventData) {
    return res.status(400).json({ error: 'roomId, eventType, and eventData are required' });
  }

  try {
    const eventDataJson = JSON.stringify(eventData);

    db.prepare(`
      INSERT INTO room_events (room_id, event_type, event_data, player_id, player_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, eventType, eventDataJson, playerId || null, playerName || null);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Erro ao salvar evento:', error);
    res.status(500).json({ error: 'Failed to save event' });
  }
});

// Carregar eventos de uma sala (para replay)
app.get('/api/rooms/:roomId/events', (req, res) => {
  const { roomId } = req.params;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  try {
    const events = db.prepare(`
      SELECT id, event_type, event_data, player_id, player_name, created_at
      FROM room_events
      WHERE room_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(roomId);

    const formattedEvents = events.map(event => ({
      id: event.id,
      eventType: event.event_type,
      eventData: JSON.parse(event.event_data),
      playerId: event.player_id,
      playerName: event.player_name,
      createdAt: event.created_at,
    }));

    res.json({ events: formattedEvents });
  } catch (error) {
    console.error('[API] Erro ao carregar eventos:', error);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// Carregar estado do board por roomId
app.get('/api/rooms/:roomId/state', (req, res) => {
  const { roomId } = req.params;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  try {
    const row = db.prepare('SELECT board_state FROM rooms WHERE room_id = ?').get(roomId);

    if (!row) {
      return res.json({
        board: [],
        counters: [],
        players: [],
        cemeteryPositions: {},
        libraryPositions: {},
      });
    }

    const state = JSON.parse(row.board_state);
    res.json(state);
  } catch (error) {
    console.error('[API] Erro ao carregar estado do room:', error);
    res.status(500).json({ error: 'Failed to load room state' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on 0.0.0.0:${PORT}`);
  console.log(`[api] CORS allowed origins: ${uniqueOrigins.join(', ')}`);
});
