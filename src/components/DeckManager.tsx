import { useState } from 'react';
import type { FormEvent } from 'react';
import { parseDecklist } from '../lib/deck';
import type { DeckEntry } from '../lib/deck';
import { fetchCardByCollector, fetchCardByName } from '../lib/scryfall';
import { useGameStore } from '../store/useGameStore';

const DeckManager = () => {
  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [entries, setEntries] = useState<DeckEntry[]>([]);
  const [error, setError] = useState<string>();
  const [busyCard, setBusyCard] = useState<string>();

  const saveDeckDefinition = useGameStore((state) => state.saveDeckDefinition);
  const deleteDeckDefinition = useGameStore((state) => state.deleteDeckDefinition);
  const savedDecks = useGameStore((state) => state.savedDecks);
  const addCard = useGameStore((state) => state.addCardToBoard);
  const addCardToLibrary = useGameStore((state) => state.addCardToLibrary);
  const replaceLibrary = useGameStore((state) => state.replaceLibrary);

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

  const addEntryToLibrary = async (entry: DeckEntry) => {
    setBusyCard(entry.name);
    try {
      const card =
        entry.setCode && entry.collectorNumber
          ? await fetchCardByCollector(entry.setCode, entry.collectorNumber)
          : await fetchCardByName(entry.name, entry.setCode);
      addCardToLibrary({
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
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() => addEntryToBoard(entry)}
                    disabled={busyCard === entry.name}
                  >
                    {busyCard === entry.name ? 'Adding…' : 'To Board'}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => addEntryToLibrary(entry)}
                    disabled={busyCard === entry.name}
                  >
                    {busyCard === entry.name ? 'Adding…' : 'To Library'}
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
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      setBusyCard('loading deck');
                      try {
                        // Carregar cada carta única uma vez
                        const uniqueCards = await Promise.all(
                          deck.entries.map(async (entry) => {
                            const card =
                              entry.setCode && entry.collectorNumber
                                ? await fetchCardByCollector(entry.setCode, entry.collectorNumber)
                                : await fetchCardByName(entry.name, entry.setCode);
                            return {
                              card: {
                                name: card.name,
                                oracleText: card.oracleText,
                                manaCost: card.manaCost,
                                typeLine: card.typeLine,
                                setName: card.setName,
                                imageUrl: card.imageUrl,
                              },
                              quantity: entry.quantity,
                            };
                          })
                        );
                        
                        // Expandir cada carta pela quantidade
                        const cards: {
                          name: string;
                          oracleText?: string;
                          manaCost?: string;
                          typeLine?: string;
                          setName?: string;
                          imageUrl?: string;
                        }[] = [];
                        
                        for (const { card, quantity } of uniqueCards) {
                          for (let i = 0; i < quantity; i++) {
                            cards.push(card);
                          }
                        }
                        
                        replaceLibrary(cards);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Unable to load deck');
                      } finally {
                        setBusyCard(undefined);
                      }
                    }}
                    disabled={busyCard !== undefined}
                  >
                    {busyCard === 'loading deck' ? 'Loading...' : 'Load to Library'}
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
