import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parseDecklist } from '../lib/deck';
import type { DeckEntry } from '../lib/deck';
import { fetchCardByCollector, fetchCardByName, fetchCardsBatch } from '../lib/scryfall';
import type { BatchCardRequest } from '../lib/scryfall';
import { useGameStore } from '../store/useGameStore';

const DeckManager = () => {
  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [error, setError] = useState<string>();
  const [busyCard, setBusyCard] = useState<string>();
  const [busyLibrary, setBusyLibrary] = useState(false);

  const saveDeckDefinition = useGameStore((state) => state.saveDeckDefinition);
  const deleteDeckDefinition = useGameStore((state) => state.deleteDeckDefinition);
  const hydrateDecks = useGameStore((state) => state.hydrateDecks);
  const savedDecks = useGameStore((state) => state.savedDecks);
  const addCard = useGameStore((state) => state.addCardToBoard);
  const replaceLibrary = useGameStore((state) => state.replaceLibrary);

  useEffect(() => {
    hydrateDecks();
  }, [hydrateDecks]);

  const parse = (event: FormEvent) => {
    event.preventDefault();
    const nextEntries = parseDecklist(deckText);
    setEntries(nextEntries);
    setError(nextEntries.length === 0 ? 'No valid cards found in list.' : undefined);
  };

  const saveDeck = () => {
    if (entries.length === 0) {
      setError('Parse a deck list before saving.');
      return;
    }
    const name = deckName.trim() || 'Untitled deck';
    saveDeckDefinition(name, entries, deckText);
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

  const loadEntriesToLibrary = async (targetEntries: DeckEntry[]) => {
    if (targetEntries.length === 0) {
      setError('Parse a deck list before loading.');
      return;
    }
    setBusyLibrary(true);
    setError(undefined);
    try {
      const requests: BatchCardRequest[] = targetEntries.flatMap((entry) =>
        Array.from({ length: entry.quantity }).map(() => ({
          name: entry.name,
          setCode: entry.setCode,
          collectorNumber: entry.collectorNumber,
        })),
      );
      const results = await fetchCardsBatch(requests);
      const errors: string[] = [];
      const cards = results.flatMap((result, index) => {
        if ('error' in result) {
          const request = (result.request as BatchCardRequest | undefined)?.name ?? requests[index]?.name ?? 'unknown';
          errors.push(`${request}: ${result.error}`);
          return [];
        }
        return [
          {
            name: result.name,
            oracleText: result.oracleText,
            manaCost: result.manaCost,
            typeLine: result.typeLine,
            setName: result.setName,
            imageUrl: result.imageUrl,
            backImageUrl: result.backImageUrl,
          },
        ];
      });
      if (errors.length > 0) {
        setError(`Some cards failed to load: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? '...' : ''}`);
      }
      if (cards.length > 0) {
        replaceLibrary(cards);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load deck into library');
    } finally {
      setBusyLibrary(false);
    }
  };

  const addEntryToBoard = async (entry: DeckEntry) => {
    setBusyCard(entry.name);
    try {
      const card =
        entry.setCode && entry.collectorNumber
          ? await fetchCardByCollector(entry.setCode, entry.collectorNumber)
          : await fetchCardByName(entry.name, entry.setCode);
      addCard({
        name: card.name,
        oracleText: card.oracleText,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        setName: card.setName,
        imageUrl: card.imageUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load card');
    } finally {
      setBusyCard(undefined);
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
          <button type="submit">Parse list</button>
          <input
            type="text"
            placeholder="Deck name"
            value={deckName}
            onChange={(event) => setDeckName(event.target.value)}
          />
          <button type="button" className="primary" onClick={saveDeck} disabled={entries.length === 0}>
            Save deck
          </button>
          <button type="button" onClick={() => loadEntriesToLibrary(entries)} disabled={entries.length === 0 || busyLibrary}>
            {busyLibrary ? 'Loading…' : 'Load to library'}
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      {entries.length > 0 && (
        <div className="deck-entries">
          <h3>Parsed cards</h3>
          <ul>
            {entries.map((entry) => (
              <li key={`${entry.name}-${entry.printTag ?? ''}`}>
                <span>
                  {entry.quantity}x {entry.name}{' '}
                  {entry.printTag && <small className="muted">({entry.printTag})</small>}
                </span>
                <button
                  type="button"
                  onClick={() => addEntryToBoard(entry)}
                  disabled={busyCard === entry.name}
                >
                  {busyCard === entry.name ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
    </div>
  );
};

export default DeckManager;
