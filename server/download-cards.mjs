import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import db from './db.mjs';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const CARDS_VERSION_FILE = join(process.cwd(), 'data', 'cards-version.json');

const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const hasTwoFaces = (card) => {
  if (Array.isArray(card?.card_faces) && card.card_faces.length > 1) {
    return true;
  }
  const twoFacedLayouts = ['transform', 'modal_dfc', 'double_faced_token', 'reversible_card'];
  return twoFacedLayouts.includes(card?.layout);
};

const buildScryfallImageUrl = (cardId, face = 'front') => {
  if (!cardId) return null;
  const parts = cardId.split('-');
  if (parts.length < 1) return null;
  const firstPart = parts[0];
  if (!firstPart || firstPart.length < 2) return null;
  return `https://cards.scryfall.io/large/${face}/${firstPart[0]}/${firstPart[1]}/${cardId}.jpg`;
};

const pickImageUrl = (card) => {
  if (card?.image_uris) {
    return card.image_uris.normal || card.image_uris.large || card.image_uris.small || null;
  }
  if (hasTwoFaces(card) && Array.isArray(card?.card_faces) && card.card_faces.length > 0) {
    const frontFace = card.card_faces[0];
    if (frontFace?.image_uris) {
      return frontFace.image_uris.normal || frontFace.image_uris.large || frontFace.image_uris.small || null;
    }
    if (card.id) {
      return buildScryfallImageUrl(card.id, 'front');
    }
  }
  return card?.id ? buildScryfallImageUrl(card.id, 'front') : null;
};

const pickBackImageUrl = (card) => {
  if (hasTwoFaces(card) && Array.isArray(card?.card_faces) && card.card_faces.length > 1) {
    const backFace = card.card_faces[1];
    if (backFace?.image_uris) {
      return backFace.image_uris.normal || backFace.image_uris.large || backFace.image_uris.small || null;
    }
    if (card.id) {
      return buildScryfallImageUrl(card.id, 'back');
    }
  }
  return null;
};

const extractOracleText = (card) => {
  if (card?.oracle_text) return card.oracle_text;
  if (Array.isArray(card?.card_faces)) {
    const texts = card.card_faces
      .map((face) => face?.oracle_text)
      .filter(Boolean);
    if (texts.length > 0) {
      return texts.join('\n---\n');
    }
  }
  return null;
};

async function downloadCards() {
  try {
    console.log('[Scryfall] Verificando versão do bulk data...');
    
    const bulkListResponse = await fetch(`${SCRYFALL_BASE}/bulk-data`);
    if (!bulkListResponse.ok) {
      throw new Error(`Erro ao obter lista de bulk data: ${bulkListResponse.statusText}`);
    }
    
    const bulkList = await bulkListResponse.json();
    const defaultCards = bulkList.data.find((item) => item.type === 'default_cards');
    if (!defaultCards) {
      throw new Error('default_cards bulk data não encontrado');
    }
    
    let currentVersion = null;
    if (existsSync(CARDS_VERSION_FILE)) {
      const versionData = JSON.parse(readFileSync(CARDS_VERSION_FILE, 'utf-8'));
      currentVersion = versionData.id;
    }
    
    if (currentVersion === defaultCards.id) {
      const hasCards = !!db.prepare('SELECT 1 FROM cards LIMIT 1').get();
      if (hasCards) {
        console.log('[Scryfall] Versão não mudou e cartas já existem no banco. Nada a fazer.');
        return;
      }
    }
    
    console.log('[Scryfall] Nova versão detectada ou banco vazio');
    console.log(`[Scryfall] Baixando dados bulk de ${defaultCards.download_uri}...`);
    
    const bulkResponse = await fetch(defaultCards.download_uri);
    if (!bulkResponse.ok) {
      throw new Error(`Erro ao baixar dados bulk: ${bulkResponse.statusText}`);
    }
    
    const cards = await bulkResponse.json();
    
    console.log(`[Scryfall] Baixadas ${cards.length} cartas`);
    console.log('[Scryfall] Gravando cartas no banco de dados...');
    
    const insertCard = db.prepare(`
      INSERT INTO cards (
        id, name, name_normalized, set_code, collector_number, type_line,
        mana_cost, oracle_text, image_url, back_image_url, set_name, layout
      ) VALUES (
        @id, @name, @name_normalized, @set_code, @collector_number, @type_line,
        @mana_cost, @oracle_text, @image_url, @back_image_url, @set_name, @layout
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_normalized = excluded.name_normalized,
        set_code = excluded.set_code,
        collector_number = excluded.collector_number,
        type_line = excluded.type_line,
        mana_cost = excluded.mana_cost,
        oracle_text = excluded.oracle_text,
        image_url = excluded.image_url,
        back_image_url = excluded.back_image_url,
        set_name = excluded.set_name,
        layout = excluded.layout
    `);
    const clearCards = db.prepare('DELETE FROM cards');
    
    const insertMany = db.transaction((rows) => {
      clearCards.run();
      for (const row of rows) {
        insertCard.run(row);
      }
    });
    
    const preparedRows = cards
      .filter((card) => card?.id && card?.name)
      .map((card) => {
        const trimmedName = card.name.trim();
        return {
          id: card.id,
          name: trimmedName,
          name_normalized: trimmedName.toLowerCase(),
          set_code: card.set ? card.set.toLowerCase() : null,
          collector_number: card.collector_number ?? null,
          type_line: card.type_line ?? null,
          mana_cost: card.mana_cost ?? null,
          oracle_text: extractOracleText(card),
          image_url: pickImageUrl(card),
          back_image_url: pickBackImageUrl(card),
          set_name: card.set_name ?? null,
          layout: card.layout ?? null,
        };
      });
    
    insertMany(preparedRows);
    
    writeFileSync(CARDS_VERSION_FILE, JSON.stringify({
      id: defaultCards.id,
      updated_at: defaultCards.updated_at,
      downloaded_at: new Date().toISOString(),
    }), 'utf-8');
    
    console.log(`[Scryfall] ${preparedRows.length} cartas salvas no banco com sucesso!`);
  } catch (error) {
    console.error('[Scryfall] Erro ao baixar dados:', error);
    process.exit(1);
  }
}

downloadCards();






