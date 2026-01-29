export interface CardLookupResult {
  name: string;
  oracleText?: string;
  manaCost?: string;
  typeLine?: string;
  imageUrl?: string;
  backImageUrl?: string; // Imagem do verso da carta (para cartas com duas faces)
  setName?: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const ensureOk = async (response: Response) => {
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || details.details || 'Unable to fetch card');
  }
  return response;
};

export const fetchCardByName = async (name: string, setCode?: string): Promise<CardLookupResult> => {
  const params = new URLSearchParams({ name });
  if (setCode) {
    params.append('set', setCode);
  }

  const response = await fetch(`${API_URL}/cards/search?${params.toString()}`);
  await ensureOk(response);
  return await response.json();
};

export const fetchCardByCollector = async (setCode: string, collectorNumber: string): Promise<CardLookupResult> => {
  const response = await fetch(`${API_URL}/cards/${setCode}/${collectorNumber}`);
  await ensureOk(response);
  return await response.json();
};

export interface BatchCardRequest {
  name?: string;
  setCode?: string;
  collectorNumber?: string;
}

export const fetchCardsBatch = async (requests: BatchCardRequest[]): Promise<(CardLookupResult | { error: string; request?: BatchCardRequest })[]> => {
  const response = await fetch(`${API_URL}/cards/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cards: requests }),
  });
  await ensureOk(response);
  return await response.json();
};
