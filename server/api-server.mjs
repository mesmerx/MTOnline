import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { randomBytes, createHash, createHmac } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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

// Carregar dados de cartas
const CARDS_FILE = join(process.cwd(), 'data', 'cards.json');
let cardsData = null;

function loadCardsData() {
  try {
    if (existsSync(CARDS_FILE)) {
      console.log(`[api] Carregando cartas de ${CARDS_FILE}...`);
      const fileContent = readFileSync(CARDS_FILE, 'utf-8');
      cardsData = JSON.parse(fileContent);
      console.log(`[api] ${cardsData.length} cartas carregadas`);
    } else {
      console.warn(`[api] Arquivo de cartas não encontrado: ${CARDS_FILE}`);
      console.warn(`[api] Execute: node server/download-cards.mjs`);
    }
  } catch (error) {
    console.error('[api] Erro ao carregar cartas:', error);
  }
}

loadCardsData();

// Função para calcular similaridade entre strings (fuzzy matching)
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

// Função para extrair URL da imagem
function pickImageUrl(card) {
  if (card?.image_uris) {
    return card.image_uris.normal || card.image_uris.large || card.image_uris.small;
  }
  
  if (Array.isArray(card?.card_faces) && card.card_faces.length > 0) {
    const faceWithImage = card.card_faces.find((face) => face.image_uris) || card.card_faces[0];
    return faceWithImage?.image_uris?.normal ?? faceWithImage?.image_uris?.large;
  }
  
  return undefined;
}

// Função para converter carta do Scryfall para formato da API
function toCardResult(card) {
  return {
    name: card?.name ?? 'Unknown',
    oracleText: card?.oracle_text,
    manaCost: card?.mana_cost,
    typeLine: card?.type_line,
    imageUrl: pickImageUrl(card),
    setName: card?.set_name,
  };
}

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
  if (!cardsData) {
    return res.status(503).json({ error: 'Cards data not loaded. Run: node server/download-cards.mjs' });
  }

  const { name, set: setCode } = req.query;
  
  if (!name) {
    return res.status(400).json({ error: 'name parameter is required' });
  }

  const queryLower = name.toLowerCase().trim();
  
  // Primeiro, tentar match exato
  let candidates = cardsData.filter((card) => {
    if (!card.name) return false;
    const cardNameLower = card.name.toLowerCase();
    if (setCode) {
      return cardNameLower === queryLower && card.set?.toLowerCase() === setCode.toLowerCase();
    }
    return cardNameLower === queryLower;
  });
  
  // Se não encontrou match exato, fazer fuzzy search
  if (candidates.length === 0) {
    const scored = cardsData
      .map((card) => ({
        card,
        score: fuzzyMatch(queryLower, card.name?.toLowerCase() || ''),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    
    candidates = scored.slice(0, 10).map(item => item.card);
    
    // Filtrar por set se especificado
    if (setCode) {
      candidates = candidates.filter((card) => 
        card.set?.toLowerCase() === setCode.toLowerCase()
      );
    }
  }
  
  // Retornar a melhor correspondência
  if (candidates.length > 0) {
    return res.json(toCardResult(candidates[0]));
  }
  
  res.status(404).json({ error: 'Card not found' });
});

app.get('/cards/:setCode/:collectorNumber', (req, res) => {
  if (!cardsData) {
    return res.status(503).json({ error: 'Cards data not loaded. Run: node server/download-cards.mjs' });
  }

  const { setCode, collectorNumber } = req.params;
  
  const card = cardsData.find((c) => 
    c.set?.toLowerCase() === setCode.toLowerCase() && 
    c.collector_number === collectorNumber
  );
  
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }
  
  res.json(toCardResult(card));
});

// Endpoint batch para buscar múltiplas cartas de uma vez
app.post('/cards/batch', (req, res) => {
  if (!cardsData) {
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

    let card = null;

    // Buscar por collector number se disponível
    if (setCode && collectorNumber) {
      card = cardsData.find((c) => 
        c.set?.toLowerCase() === setCode.toLowerCase() && 
        c.collector_number === collectorNumber
      );
    }

    // Se não encontrou por collector number, buscar por nome
    if (!card && name) {
      const queryLower = name.toLowerCase().trim();
      
      // Primeiro, tentar match exato
      let candidates = cardsData.filter((c) => {
        if (!c.name) return false;
        const cardNameLower = c.name.toLowerCase();
        if (setCode) {
          return cardNameLower === queryLower && c.set?.toLowerCase() === setCode.toLowerCase();
        }
        return cardNameLower === queryLower;
      });
      
      // Se não encontrou match exato, fazer fuzzy search
      if (candidates.length === 0) {
        const scored = cardsData
          .map((c) => ({
            card: c,
            score: fuzzyMatch(queryLower, c.name?.toLowerCase() || ''),
          }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score);
        
        candidates = scored.slice(0, 10).map(item => item.card);
        
        // Filtrar por set se especificado
        if (setCode) {
          candidates = candidates.filter((c) => 
            c.set?.toLowerCase() === setCode.toLowerCase()
          );
        }
      }
      
      if (candidates.length > 0) {
        card = candidates[0];
      }
    }

    if (!card) {
      return { error: 'Card not found', request };
    }

    return toCardResult(card);
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on 0.0.0.0:${PORT}`);
  console.log(`[api] CORS allowed origins: ${uniqueOrigins.join(', ')}`);
});

