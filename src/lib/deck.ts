import { randomId } from './id';

export interface DeckEntry {
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  printTag?: string;
}

export interface SavedDeck {
  id: string;
  name: string;
  createdAt: string;
  entries: DeckEntry[];
  rawText: string;
  isPublic?: boolean;
  author?: string;
}

const STORAGE_KEY = 'mtonline.decks';

export const parseDecklist = (rawList: string): DeckEntry[] => {
  const entries: DeckEntry[] = [];
  rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('//') || /^sideboard/i.test(line)) {
        return;
      }

      const normalized = line.replace(/^SB[:\-]?\s*/i, '');
      const match = normalized.match(/^(\d+)\s*x?\s+([^(]+?)(?:\s+\(([^)]+)\))?(?:\s+(\d+))?$/i);
      if (!match) {
        return;
      }

      const [, qty, name, printTag, trailingNumber] = match;
      const entry: DeckEntry = {
        quantity: Number(qty),
        name: name.trim(),
      };

      const tag = printTag?.trim();
      if (tag) {
        entry.printTag = tag;
        const setMatch = tag.match(/^([A-Za-z]{2,5})(\d+)?$/);
        if (setMatch) {
          entry.setCode = setMatch[1]?.toLowerCase();
          if (setMatch[2]) {
            entry.collectorNumber = setMatch[2];
          }
        }
      }

      if (!entry.collectorNumber && trailingNumber) {
        entry.collectorNumber = trailingNumber;
      }

      entries.push(entry);
    });

  return entries;
};

export const loadDecks = (): SavedDeck[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedDeck[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const persistDecks = (decks: SavedDeck[]) => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
};

export const saveDeck = (name: string, entries: DeckEntry[], rawText: string, previousDecks: SavedDeck[]) => {
  const nextDecks = [
    {
      id: randomId(),
      name,
      entries,
      rawText,
      createdAt: new Date().toISOString(),
    },
    ...previousDecks,
  ];

  persistDecks(nextDecks);
  return nextDecks;
};

export const deleteDeck = (deckId: string, decks: SavedDeck[]) => {
  const nextDecks = decks.filter((deck) => deck.id !== deckId);
  persistDecks(nextDecks);
  return nextDecks;
};

export const replaceDecks = (nextDecks: SavedDeck[]) => {
  persistDecks(nextDecks);
  return nextDecks;
};

