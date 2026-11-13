import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/common/idempotency/canonical-json.js';
import { idempotencyRequestHash } from '../../src/common/idempotency/idempotency.interceptor.js';
import { IDEMPOTENCY_KEY_PATTERN } from '../../src/common/idempotency/idempotency.store.js';
import { uuidv7 } from '../../src/common/idempotency/uuid7.js';
import { CreateTeamApplicationDto } from '../../src/team-applications/team-applications.dto.js';
import {
  pickFreeSlug,
  publicLeftReason,
  slugBaseFromName,
} from '../../src/team-domain/team-policy.js';

describe('team slug derivation (TEAMS.md §2)', () => {
  it('NFKD, strips diacritics, lowercases, collapses separators', () => {
    expect(slugBaseFromName('Steppe Wolves')).toBe('steppe-wolves');
    expect(slugBaseFromName('Ñandú  Gaming..Club')).toBe('nandu-gaming-club');
    expect(slugBaseFromName('_Team_-_X_')).toBe('team-x');
    expect(slugBaseFromName('ＦＵＬＬ width')).toBe('full-width');
  });
  it('max 48 without trailing dash; empty → team-<random6>', () => {
    const long = slugBaseFromName('a'.repeat(47) + ' b');
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith('-')).toBe(false);
    expect(slugBaseFromName('Қасқыр')).toMatch(/^team-[a-z0-9]{6}$/);
  });
  it('UUID-shaped results are prefixed', () => {
    expect(slugBaseFromName('0b6b6c4e-7c0e-4d1b-9a43-0d8b0b0e8a11')).toMatch(/^team-/);
  });
  it('collisions and reserved slugs get -2, -3 …', () => {
    expect(pickFreeSlug('wolves', new Set())).toBe('wolves');
    expect(pickFreeSlug('wolves', new Set(['wolves', 'wolves-2']))).toBe('wolves-3');
    expect(pickFreeSlug('apply', new Set())).toBe('apply-2');
  });
  it('only enumerated left reasons are public', () => {
    expect(publicLeftReason('removed')).toBe('removed');
    expect(publicLeftReason('kicked for cheating')).toBeNull();
    expect(publicLeftReason(null)).toBeNull();
  });
});

describe('application DTO validation', () => {
  const check = async (body: object) =>
    (await validate(plainToInstance(CreateTeamApplicationDto, body))).map((e) => e.property);
  it('accepts a valid application and normalises name', async () => {
    const dto = plainToInstance(CreateTeamApplicationDto, {
      name: '  Café Club ',
      tag: 'CAFE',
      description: '',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Café Club');
    expect(dto.description).toBeNull();
  });
  it('rejects bad name / tag / country / description', async () => {
    expect(await check({ name: 'ab', tag: 'OK' })).toEqual(['name']);
    expect(await check({ name: '-dash first', tag: 'OK' })).toEqual(['name']);
    expect(await check({ name: 'Evil‮Name', tag: 'OK' })).toEqual(['name']);
    expect(await check({ name: 'Good Name', tag: 'TOOLONG' })).toEqual(['tag']);
    expect(await check({ name: 'Good Name', tag: 'A' })).toEqual(['tag']);
    expect(await check({ name: 'Good Name', tag: 'A-B' })).toEqual(['tag']);
    expect(await check({ name: 'Good Name', tag: 'OK', countryCode: 'kz' })).toEqual([
      'countryCode',
    ]);
    expect(await check({ name: 'Good Name', tag: 'OK', description: 'x\u0007' })).toEqual([
      'description',
    ]);
    expect(await check({ name: 'Good Name', tag: 'OK', description: 'x'.repeat(501) })).toEqual([
      'description',
    ]);
  });
});

describe('idempotency helpers', () => {
  it('canonical JSON ignores key order and undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
  it('request hash covers method, route, params and body', () => {
    const base = idempotencyRequestHash('POST', '/r/:id', { id: '1' }, { a: 1, b: 2 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(idempotencyRequestHash('POST', '/r/:id', { id: '1' }, { b: 2, a: 1 })).toBe(base);
    expect(idempotencyRequestHash('POST', '/r/:id', { id: '2' }, { a: 1, b: 2 })).not.toBe(base);
    expect(idempotencyRequestHash('POST', '/r/:id', { id: '1' }, { a: 1 })).not.toBe(base);
    expect(idempotencyRequestHash('POST', '/x/:id', { id: '1' }, { a: 1, b: 2 })).not.toBe(base);
    expect(idempotencyRequestHash('POST', '/r', {}, undefined)).toBe(
      idempotencyRequestHash('POST', '/r', {}, {}),
    );
  });
  it('key format', () => {
    expect(IDEMPOTENCY_KEY_PATTERN.test('0b6b6c4e-7c0e-4d1b-9a43-0d8b0b0e8a11')).toBe(true);
    expect(IDEMPOTENCY_KEY_PATTERN.test('short')).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('x'.repeat(65))).toBe(false);
    expect(IDEMPOTENCY_KEY_PATTERN.test('has space in it 123')).toBe(false);
  });
  it('uuidv7 is version 7, variant 10 and time-ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });
});
