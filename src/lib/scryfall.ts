export interface CardLookupResult {
  name: string;
  oracleText?: string;
  manaCost?: string;
  typeLine?: string;
  imageUrl?: string;
  setName?: string;
}

const SCRYFALL_BASE = 'https://api.scryfall.com';

const pickImageUrl = (data: any): string | undefined => {
  if (data?.image_uris) {
    return data.image_uris.normal || data.image_uris.large || data.image_uris.small;
  }

  if (Array.isArray(data?.card_faces) && data.card_faces.length > 0) {
    const faceWithImage = data.card_faces.find((face: any) => face.image_uris) || data.card_faces[0];
    return faceWithImage?.image_uris?.normal ?? faceWithImage?.image_uris?.large;
  }

  return undefined;
};

const toResult = (data: any): CardLookupResult => ({
  name: data?.name ?? 'Unknown',
  oracleText: data?.oracle_text,
  manaCost: data?.mana_cost,
  typeLine: data?.type_line,
  imageUrl: pickImageUrl(data),
  setName: data?.set_name,
});

const ensureOk = async (response: Response) => {
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.details || details.error || 'Unable to reach Scryfall');
  }

  return response;
};

export const fetchCardByName = async (name: string, setCode?: string) => {
  const params = new URLSearchParams({ fuzzy: name });
  if (setCode) {
    params.append('set', setCode);
  }

  const response = await fetch(`${SCRYFALL_BASE}/cards/named?${params.toString()}`);
  await ensureOk(response);
  const data = await response.json();
  return toResult(data);
};

export const fetchCardByCollector = async (setCode: string, collectorNumber: string) => {
  const response = await fetch(`${SCRYFALL_BASE}/cards/${setCode}/${collectorNumber}`);
  await ensureOk(response);
  const data = await response.json();
  return toResult(data);
};
