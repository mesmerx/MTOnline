import { randomId } from './id';

export interface DeckEntry {
  quantity: number;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  printTag?: string;
  section?: 'commander' | 'mainboard' | 'maybeboard' | 'tokens';
  tags?: string[];
  flags?: string[];
  isCommander?: boolean;
  isToken?: boolean;
  noDeck?: boolean;
}

export type DeckEntryPlacement = 'library' | 'commander' | 'tokens';

export const classifyDeckEntry = (entry: DeckEntry, cardTypeLine?: string): DeckEntryPlacement => {
  const normalizedType = cardTypeLine?.toLowerCase() ?? '';
  const inferredToken = normalizedType.includes('token');
  if (entry.isCommander || entry.section === 'commander') {
    return 'commander';
  }
  if (entry.isToken || entry.section === 'tokens' || entry.noDeck || inferredToken) {
    return 'tokens';
  }
  return 'library';
};

export const formatDecklist = (entries: DeckEntry[]): string => {
  const sections: Array<{ title: string; key: DeckEntry['section'] }> = [
    { title: 'Commander', key: 'commander' },
    { title: 'Mainboard', key: 'mainboard' },
    { title: 'Maybeboard', key: 'maybeboard' },
    { title: 'Tokens', key: 'tokens' },
  ];

  const grouped = sections.map((section) => ({
    title: section.title,
    entries: entries.filter((entry) => (entry.section ?? 'mainboard') === section.key),
  }));

  const lines: string[] = [];
  grouped.forEach((group) => {
    if (group.entries.length === 0) return;
    lines.push(group.title);
    group.entries.forEach((entry) => {
      const parts: string[] = [];
      parts.push(`${entry.quantity}x ${entry.name}`);
      if (entry.printTag) {
        parts.push(`(${entry.printTag})`);
      } else if (entry.setCode) {
        const tag = `${entry.setCode.toUpperCase()}${entry.collectorNumber ?? ''}`;
        parts.push(`(${tag})`);
      }
      lines.push(parts.join(' '));
    });
    lines.push('');
  });

  return lines.join('\n').trim();
};

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
  let currentSection: DeckEntry['section'] = 'mainboard';
  rawList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .forEach((line) => {
      if (!line || line.startsWith('//')) {
        return;
      }

      if (/^commander$/i.test(line)) {
        currentSection = 'commander';
        return;
      }
      if (/^(mainboard|maindeck)$/i.test(line)) {
        currentSection = 'mainboard';
        return;
      }
      if (/^maybeboard$/i.test(line)) {
        currentSection = 'maybeboard';
        return;
      }
      if (/^tokens?$/i.test(line)) {
        currentSection = 'tokens';
        return;
      }
      if (/^sideboard/i.test(line)) {
        return;
      }

      let normalized = line.replace(/^SB[:\-]?\s*/i, '');
      let bracketLabel: string | undefined;
      let bracketFlags: string[] = [];
      const bracketMatch = normalized.match(/\s*\[([^\]]+)\]\s*$/);
      if (bracketMatch) {
        const bracketText = bracketMatch[1]?.trim();
        normalized = normalized.slice(0, bracketMatch.index).trim();
        if (bracketText) {
          const label = bracketText.split('{')[0]?.trim();
          if (label) {
            bracketLabel = label;
          }
          const flagMatches = [...bracketText.matchAll(/\{([^}]+)\}/g)];
          bracketFlags = flagMatches
            .flatMap((match) => match[1]?.split(/[,\s]+/) ?? [])
            .map((flag) => flag.trim())
            .filter((flag) => flag.length > 0);
        }
      }
      
      // Remove foil/finish markers like *F* or *Foil*
      normalized = normalized.replace(/\s*\*[^*]+\*\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();

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

      let section = currentSection;
      const rawLabel = bracketLabel?.trim();
      const label = rawLabel?.toLowerCase();
      if (label) {
        if (label.includes('commander')) {
          section = 'commander';
        } else if (label.includes('token')) {
          section = 'tokens';
        } else if (label.includes('maybeboard')) {
          section = 'maybeboard';
        } else if (label.includes('main')) {
          section = 'mainboard';
        }
        entry.tags = [rawLabel ?? label];
      }
      if (bracketFlags.length > 0) {
        entry.flags = bracketFlags;
      }
      entry.section = section;
      entry.isCommander = section === 'commander';
      entry.isToken = section === 'tokens';
      entry.noDeck = bracketFlags.some((flag) => flag.toLowerCase() === 'nodeck');

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

