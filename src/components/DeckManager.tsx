import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parseDecklist, classifyDeckEntry, formatDecklist } from '../lib/deck';
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
  const addCardToCommander = useGameStore((state) => state.addCardToCommander);
  const addCardToTokens = useGameStore((state) => state.addCardToTokens);
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

  const exportDeck = () => {
    if (entries.length === 0) {
      setError('Parse a deck list before exporting.');
      return;
    }
    const deckName = deckName.trim() || 'decklist';
    const content = formatDecklist(entries);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${deckName}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
      const expandedEntries = targetEntries.flatMap((entry) =>
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
        imageUrl?: string;
        backImageUrl?: string;
      };
      const libraryCards: CardPayload[] = [];
      const commanderCards: CardPayload[] = [];
      const tokenCards: CardPayload[] = [];

      results.forEach((result, index) => {
        const entry = expandedEntries[index];
        if ('error' in result) {
          const request = (result.request as BatchCardRequest | undefined)?.name ?? entry?.name ?? requests[index]?.name ?? 'unknown';
          errors.push(`${request}: ${result.error}`);
          return;
        }

        const payload = {
          name: result.name,
          oracleText: result.oracleText,
          manaCost: result.manaCost,
          typeLine: result.typeLine,
          setName: result.setName,
          imageUrl: result.imageUrl,
          backImageUrl: result.backImageUrl,
        };

        const placement = entry ? classifyDeckEntry(entry, result.typeLine) : 'library';

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

  const addEntryToBoard = async (entry: DeckEntry) => {
    setBusyCard(entry.name);
    try {
      const card =
        entry.setCode && entry.collectorNumber
          ? await fetchCardByCollector(entry.setCode, entry.collectorNumber)
          : await fetchCardByName(entry.name, entry.setCode);
      const payload = {
        name: card.name,
        oracleText: card.oracleText,
        manaCost: card.manaCost,
        typeLine: card.typeLine,
        setName: card.setName,
        imageUrl: card.imageUrl,
      };
      const placement = classifyDeckEntry(entry, card.typeLine);
      if (placement === 'commander') {
        addCardToCommander(payload);
      } else if (placement === 'tokens') {
        addCardToTokens(payload);
      } else {
        addCard(payload);
      }
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
          <button type="button" onClick={exportDeck} disabled={entries.length === 0}>
            Export deck
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
            {entries.map((entry, index) => (
              <li key={`${entry.name}-${entry.printTag ?? ''}-${index}`}>
                <span>
                  {entry.quantity}x {entry.name}{' '}
                  {entry.printTag && <small className="muted">({entry.printTag})</small>}
                </span>
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => addEntryToBoard(entry)}
                    disabled={busyCard === entry.name}
                  >
                    {busyCard === entry.name ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const setCode = window.prompt('Set code (leave empty for any print):', entry.setCode ?? '');
                      if (setCode === null) return;
                      const trimmedSet = setCode.trim();
                      if (!trimmedSet) {
                        setEntries((current) =>
                          current.map((item, idx) =>
                            idx === index
                              ? { ...item, setCode: undefined, collectorNumber: undefined, printTag: undefined }
                              : item
                          )
                        );
                        return;
                      }
                      const collector = window.prompt('Collector number (optional):', entry.collectorNumber ?? '');
                      if (collector === null) return;
                      const trimmedCollector = collector.trim();
                      setEntries((current) =>
                        current.map((item, idx) =>
                          idx === index
                            ? {
                                ...item,
                                setCode: trimmedSet.toLowerCase(),
                                collectorNumber: trimmedCollector || undefined,
                                printTag: `${trimmedSet.toUpperCase()}${trimmedCollector ? trimmedCollector : ''}`,
                              }
                            : item
                        )
                      );
                    }}
                  >
                    Change print
                  </button>
                </div>
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
