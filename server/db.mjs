import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', 'data', 'mtonline.db');
const dbDir = join(__dirname, '..', 'data');

// Criar diretório se não existir
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Criar tabelas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS decks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    entries TEXT NOT NULL,
    is_public INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    board_state TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    player_id TEXT,
    player_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks(user_id);
  CREATE INDEX IF NOT EXISTS idx_decks_is_public ON decks(is_public);
  CREATE INDEX IF NOT EXISTS idx_rooms_updated_at ON rooms(updated_at);
  CREATE INDEX IF NOT EXISTS idx_room_events_room_id ON room_events(room_id);
  CREATE INDEX IF NOT EXISTS idx_room_events_created_at ON room_events(created_at);

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    set_code TEXT,
    collector_number TEXT,
    type_line TEXT,
    mana_cost TEXT,
    oracle_text TEXT,
    image_url TEXT,
    back_image_url TEXT,
    set_name TEXT,
    layout TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cards_name_normalized ON cards(name_normalized);
  CREATE INDEX IF NOT EXISTS idx_cards_set_collector ON cards(set_code, collector_number);
`);

// Adicionar coluna is_public se não existir (migração)
try {
  db.exec('ALTER TABLE decks ADD COLUMN is_public INTEGER DEFAULT 0');
} catch (e) {
  // Coluna já existe, ignorar
}

export default db;
