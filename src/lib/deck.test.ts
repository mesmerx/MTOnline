import { describe, expect, it } from 'vitest';
import { classifyDeckEntry, parseDecklist } from './deck';

describe('parseDecklist', () => {
  it('parses sections and tags for commander and tokens', () => {
    const list = `
Commander
1x Umbris, Fear Manifest (sld) 2339 *F* [Commander{top}]

Mainboard
1x Sol Ring (eoc) 57 [Artifact]

Maybeboard
1x Copy (ttla) 1 [Tokens & Extras{noDeck}]
`;
    const entries = parseDecklist(list);
    const umbris = entries.find((e) => e.name === 'Umbris, Fear Manifest');
    const solRing = entries.find((e) => e.name === 'Sol Ring');
    const copy = entries.find((e) => e.name === 'Copy');

    expect(umbris?.section).toBe('commander');
    expect(umbris?.isCommander).toBe(true);
    expect(umbris?.flags).toContain('top');

    expect(solRing?.section).toBe('mainboard');

    expect(copy?.section).toBe('tokens');
    expect(copy?.isToken).toBe(true);
    expect(copy?.noDeck).toBe(true);
  });

  it('parses full list and flags commander/tokens', () => {
    const list = `
Commander
1x Umbris, Fear Manifest (sld) 2339 *F* [Commander{top}]

Mainboard
1x Sol Ring (eoc) 57 [Artifact]
1x Uchuulon (clb) 673 [Tokens]

Maybeboard
1x Copy (ttla) 1 [Tokens & Extras{noDeck}]
1x Treasure (ttla) 22 [Tokens & Extras{noDeck}]
`;
    const entries = parseDecklist(list);
    const commander = entries.find((e) => e.name === 'Umbris, Fear Manifest');
    const tokenMain = entries.find((e) => e.name === 'Uchuulon');
    const copy = entries.find((e) => e.name === 'Copy');
    const treasure = entries.find((e) => e.name === 'Treasure');

    expect(commander?.section).toBe('commander');
    expect(commander?.isCommander).toBe(true);

    expect(tokenMain?.section).toBe('tokens');
    expect(tokenMain?.isToken).toBe(true);

    expect(copy?.noDeck).toBe(true);
    expect(treasure?.noDeck).toBe(true);
  });
});

describe('classifyDeckEntry', () => {
  it('infers tokens from card info when missing section', () => {
    const placement = classifyDeckEntry({ quantity: 1, name: 'Treasure' }, 'Token Artifact — Treasure');
    expect(placement).toBe('tokens');
  });

  it('prefers commander section', () => {
    const placement = classifyDeckEntry({ quantity: 1, name: 'Commander Card', section: 'commander' }, 'Legendary Creature');
    expect(placement).toBe('commander');
  });
});

