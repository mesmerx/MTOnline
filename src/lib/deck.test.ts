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

