import { useState } from 'react';
import type { FormEvent } from 'react';
import { fetchCardByName } from '../lib/scryfall';
import type { CardLookupResult } from '../lib/scryfall';
import { useGameStore } from '../store/useGameStore';

const CardSearch = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CardLookupResult | null>(null);
  const [error, setError] = useState<string>();
  const addCard = useGameStore((state) => state.addCardToBoard);
  const isDisabled = !query.trim();

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    try {
      setError(undefined);
      setLoading(true);
      const card = await fetchCardByName(query.trim());
      setResult(card);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Unable to find card');
    } finally {
      setLoading(false);
    }
  };

  const addToBoard = () => {
    if (!result) return;
    addCard({
      name: result.name,
      oracleText: result.oracleText,
      manaCost: result.manaCost,
      typeLine: result.typeLine,
      setName: result.setName,
      setCode: result.setCode,
      collectorNumber: result.collectorNumber,
      imageUrl: result.imageUrl,
      backImageUrl: result.backImageUrl,
    });
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Card search</h2>
      </div>

      <form onSubmit={search} className="card-search-form">
        <input
          type="text"
          placeholder="Birds of Paradise"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="primary" type="submit" disabled={isDisabled || loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {result && (
        <div className="card-preview">
          {result.imageUrl && <img src={result.imageUrl} alt={result.name} />}
          <div>
            <h3>{result.name}</h3>
            {result.manaCost && <p className="muted">{result.manaCost}</p>}
            {result.typeLine && <p>{result.typeLine}</p>}
            {result.oracleText && <p className="oracle-text">{result.oracleText}</p>}
            <button type="button" onClick={addToBoard}>
              Add to board
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardSearch;
