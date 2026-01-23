import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const CARDS_FILE = join(process.cwd(), 'data', 'cards.json');
const CARDS_VERSION_FILE = join(process.cwd(), 'data', 'cards-version.json');

// Criar diretório data se não existir
import { mkdirSync } from 'fs';
const dataDir = join(process.cwd(), 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

async function downloadCards() {
  try {
    console.log('[Scryfall] Verificando versão do bulk data...');
    
    // Obter lista de bulk data disponíveis
    const bulkListResponse = await fetch(`${SCRYFALL_BASE}/bulk-data`);
    if (!bulkListResponse.ok) {
      throw new Error(`Erro ao obter lista de bulk data: ${bulkListResponse.statusText}`);
    }
    
    const bulkList = await bulkListResponse.json();
    
    // Encontrar o arquivo "default-cards"
    const defaultCards = bulkList.data.find((item) => item.type === 'default_cards');
    if (!defaultCards) {
      throw new Error('default_cards bulk data não encontrado');
    }
    
    // Verificar se já temos a versão atual
    let currentVersion = null;
    if (existsSync(CARDS_VERSION_FILE)) {
      const versionData = JSON.parse(readFileSync(CARDS_VERSION_FILE, 'utf-8'));
      currentVersion = versionData.id;
    }
    
    if (currentVersion === defaultCards.id && existsSync(CARDS_FILE)) {
      console.log('[Scryfall] Versão não mudou, usando arquivo existente');
      console.log(`[Scryfall] Arquivo: ${CARDS_FILE}`);
      return;
    }
    
    console.log('[Scryfall] Nova versão detectada ou arquivo ausente');
    console.log(`[Scryfall] Baixando dados bulk de ${defaultCards.download_uri}...`);
    console.log('[Scryfall] Isso pode levar vários minutos...');
    
    // Baixar o arquivo bulk
    const bulkResponse = await fetch(defaultCards.download_uri);
    if (!bulkResponse.ok) {
      throw new Error(`Erro ao baixar dados bulk: ${bulkResponse.statusText}`);
    }
    
    const cards = await bulkResponse.json();
    
    console.log(`[Scryfall] Baixadas ${cards.length} cartas`);
    console.log(`[Scryfall] Salvando em ${CARDS_FILE}...`);
    
    // Salvar cartas
    writeFileSync(CARDS_FILE, JSON.stringify(cards), 'utf-8');
    
    // Salvar versão
    writeFileSync(CARDS_VERSION_FILE, JSON.stringify({
      id: defaultCards.id,
      updated_at: defaultCards.updated_at,
      downloaded_at: new Date().toISOString(),
    }), 'utf-8');
    
    console.log('[Scryfall] Dados salvos com sucesso!');
    console.log(`[Scryfall] Arquivo: ${CARDS_FILE}`);
    console.log(`[Scryfall] Tamanho: ${(cards.length / 1000).toFixed(1)}k cartas`);
  } catch (error) {
    console.error('[Scryfall] Erro ao baixar dados:', error);
    process.exit(1);
  }
}

downloadCards();




