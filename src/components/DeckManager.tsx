import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parseDecklist, classifyDeckEntry } from '../lib/deck';
import type { DeckEntry } from '../lib/deck';
import { fetchCardsBatch, fetchCardPrints } from '../lib/scryfall';
import type { BatchCardRequest } from '../lib/scryfall';
import { useGameStore } from '../store/useGameStore';

const DeckManager = () => {
  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string>();
  const [busyLibrary, setBusyLibrary] = useState(false);

  const saveDeckDefinition = useGameStore((state) => state.saveDeckDefinition);
  const deleteDeckDefinition = useGameStore((state) => state.deleteDeckDefinition);
  const hydrateDecks = useGameStore((state) => state.hydrateDecks);
  const savedDecks = useGameStore((state) => state.savedDecks);
  const addCardToCommander = useGameStore((state) => state.addCardToCommander);
  const addCardToTokens = useGameStore((state) => state.addCardToTokens);
  const replaceLibrary = useGameStore((state) => state.replaceLibrary);
  const resetBoard = useGameStore((state) => state.resetBoard);
  const loadPublicDecks = useGameStore((state) => state.loadPublicDecks);
  const publicDecks = useGameStore((state) => state.publicDecks);

  useEffect(() => {
    hydrateDecks();
    loadPublicDecks();
  }, [hydrateDecks, loadPublicDecks]);

  const parse = (event: FormEvent) => {
    event.preventDefault();
    const nextEntries = parseDecklist(deckText);
    setEntries(nextEntries);
    setError(nextEntries.length === 0 ? 'No valid cards found in list.' : undefined);
  };

  const ensureEntries = (sourceText: string) => {
    const nextEntries = parseDecklist(sourceText);
    setEntries(nextEntries);
    setError(nextEntries.length === 0 ? 'No valid cards found in list.' : undefined);
    return nextEntries.length === 0 ? null : nextEntries;
  };

  const saveDeck = () => {
    if (!deckText.trim()) {
      setError('Add a deck list before saving.');
      return;
    }
    const nextEntries = entries.length > 0 ? entries : ensureEntries(deckText);
    if (!nextEntries) return;
    const name = deckName.trim() || 'Untitled deck';
    saveDeckDefinition(name, nextEntries, deckText, isPublic);
    setDeckName('');
  };


  const loadDeck = (deckId: string) => {
    const target = savedDecks.find((deck) => deck.id === deckId);
    if (!target) return;
    setDeckText(target.rawText);
    setDeckName(target.name);
    setEntries(target.entries);
    setError(undefined);
  };

  const loadPublicDeck = (deckId: string) => {
    const target = publicDecks.find((deck) => deck.id === deckId);
    if (!target) return;
    setDeckText(target.rawText);
    setDeckName(target.name);
    setEntries(target.entries);
    setError(undefined);
  };

  const loadEntriesToLibrary = async (targetEntries: DeckEntry[]) => {
    const nextEntries = targetEntries.length > 0 ? targetEntries : ensureEntries(deckText);
    if (!nextEntries) return;
    setBusyLibrary(true);
    setError(undefined);
    try {
      resetBoard();
      const expandedEntries = nextEntries.flatMap((entry) =>
        Array.from({ length: entry.quantity }).map(() => entry),
      );
      const requests: BatchCardRequest[] = expandedEntries.map((entry) => ({
        name: entry.name,
        setCode: entry.setCode,
        collectorNumber: entry.collectorNumber,
      }));
      const results = await fetchCardsBatch(requests);
      const errors: string[] = [];
      type CardPayload = {
        name: string;
        oracleText?: string;
        manaCost?: string;
        typeLine?: string;
        setName?: string;
        setCode?: string;
        collectorNumber?: string;
        deckSection?: DeckEntry['section'];
        deckTag?: string;
        deckFlags?: string[];
        finishTags?: string[];
        imageUrl?: string;
        backImageUrl?: string;
      };
      const libraryCards: CardPayload[] = [];
      const commanderCards: CardPayload[] = [];
      const tokenCards: CardPayload[] = [];

      const normalizeSetLabel = (value?: string) => value?.trim().toLowerCase();
      const resolvePrintBySetName = async (entry: DeckEntry, base: CardPayload) => {
        if (!entry.printTag || entry.setCode) return base;
        const requested = normalizeSetLabel(entry.printTag);
        if (!requested) return base;
        if (normalizeSetLabel(base.setName) === requested) return base;
        try {
          const prints = await fetchCardPrints(base.name);
          const match = prints.find(
            (print) =>
              normalizeSetLabel(print.setName) === requested ||
              normalizeSetLabel(print.setCode) === requested
          );
          if (!match) return base;
          return {
            ...base,
            setName: match.setName ?? base.setName,
            setCode: match.setCode ?? base.setCode,
            collectorNumber: match.collectorNumber ?? base.collectorNumber,
            imageUrl: match.imageUrl ?? base.imageUrl,
            backImageUrl: match.backImageUrl ?? base.backImageUrl,
          };
        } catch {
          return base;
        }
      };

      const resolvedResults = await Promise.all(
        results.map(async (result, index) => {
          const entry = expandedEntries[index];
          if (!entry || 'error' in result) return result;
          const basePayload: CardPayload = {
            name: result.name,
            oracleText: result.oracleText,
            manaCost: result.manaCost,
            typeLine: result.typeLine,
            setName: result.setName,
            setCode: result.setCode,
            collectorNumber: result.collectorNumber,
            deckSection: entry.section,
            deckTag: entry.tags?.[0],
            deckFlags: entry.flags,
            finishTags: entry.finishTags,
            imageUrl: result.imageUrl,
            backImageUrl: result.backImageUrl,
          };
          return await resolvePrintBySetName(entry, basePayload);
        })
      );

      resolvedResults.forEach((resolved, index) => {
        const entry = expandedEntries[index];
        if (!entry) return;
        if ('error' in resolved) {
          const request = (resolved.request as BatchCardRequest | undefined)?.name ?? entry?.name ?? requests[index]?.name ?? 'unknown';
          errors.push(`${request}: ${resolved.error}`);
          return;
        }

        const payload = resolved as CardPayload;

        const placement = classifyDeckEntry(entry, payload.typeLine);

        if (placement === 'commander') {
          commanderCards.push(payload);
        } else if (placement === 'tokens') {
          tokenCards.push(payload);
        } else {
          libraryCards.push(payload);
        }
      });
      if (errors.length > 0) {
        setError(`Some cards failed to load: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '...' : ''}`);
      }
      if (libraryCards.length > 0) {
        replaceLibrary(libraryCards);
      }
      commanderCards.forEach((card) => addCardToCommander(card));
      tokenCards.forEach((card) => addCardToTokens(card));
      if (libraryCards.length === 0 && commanderCards.length === 0 && tokenCards.length === 0) {
        setError('No valid cards found for library, commander, or tokens.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load deck into library');
    } finally {
      setBusyLibrary(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Decks</h2>
      </div>

      <form onSubmit={parse} className="deck-form">
        <label className="field">
          <span>Deck list</span>
          <textarea
            rows={6}
            placeholder="1x Birds of Paradise (MD25)"
            value={deckText}
            onChange={(event) => setDeckText(event.target.value)}
          />
        </label>

        <div className="button-row">
          <input
            type="text"
            placeholder="Deck name"
            value={deckName}
            onChange={(event) => setDeckName(event.target.value)}
          />
          <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            <span>Public</span>
          </label>
          <button type="button" className="primary" onClick={saveDeck} disabled={!deckText.trim()}>
            Save deck
          </button>
          <button type="button" onClick={() => loadEntriesToLibrary(entries)} disabled={busyLibrary || (!entries.length && !deckText.trim())}>
            {busyLibrary ? 'Loading…' : 'Load to library'}
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      {savedDecks.length > 0 && (
        <div className="saved-decks">
          <h3>Saved decks</h3>
          <ul>
            {savedDecks.map((deck) => (
              <li key={deck.id}>
                <div>
                  <strong>{deck.name}</strong>
                  <small className="muted">{new Date(deck.createdAt).toLocaleString()}</small>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => loadDeck(deck.id)}>
                    Load
                  </button>
                  <button type="button" onClick={() => loadEntriesToLibrary(deck.entries)} disabled={busyLibrary}>
                    {busyLibrary ? 'Loading…' : 'Load to library'}
                  </button>
                  <button type="button" className="ghost" onClick={() => deleteDeckDefinition(deck.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {publicDecks.length > 0 && (
        <div className="saved-decks">
          <h3>Public decks</h3>
          <ul>
            {publicDecks.map((deck) => (
              <li key={deck.id}>
                <div>
                  <strong>{deck.name}</strong>
                  <small className="muted">
                    {deck.author ? `${deck.author} · ` : ''}
                    {new Date(deck.createdAt).toLocaleString()}
                  </small>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => loadPublicDeck(deck.id)}>
                    Load
                  </button>
                  <button type="button" onClick={() => loadEntriesToLibrary(deck.entries)} disabled={busyLibrary}>
                    {busyLibrary ? 'Loading…' : 'Load to library'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DeckManager;
