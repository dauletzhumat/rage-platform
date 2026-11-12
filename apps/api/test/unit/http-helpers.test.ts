import { NotFoundException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { flattenValidationErrors } from '../../src/common/errors/validation.js';
import { SLUG_PATTERN, SlugParamPipe } from '../../src/common/http/params.js';
import { resolveRequestId } from '../../src/common/http/request-id.js';
import { pageOf, toSkipTake } from '../../src/common/pagination/pagination.js';

function fakeReqRes(header?: string) {
  const headers: Record<string, string> = {};
  const req = {
    headers: header === undefined ? {} : { 'x-request-id': header },
  } as IncomingMessage;
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
  } as unknown as ServerResponse;
  return { req, res, headers };
}

describe('resolveRequestId', () => {
  it('echoes a safe caller-supplied id', () => {
    const { req, res, headers } = fakeReqRes('abc-123_x.y:z');
    expect(resolveRequestId(req, res)).toBe('abc-123_x.y:z');
    expect(headers['x-request-id']).toBe('abc-123_x.y:z');
  });

  it.each(['', 'has space', 'line\nbreak', 'x'.repeat(129), '<script>'])(
    'replaces unsafe id %j with a generated UUID',
    (bad) => {
      const { req, res } = fakeReqRes(bad);
      expect(resolveRequestId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('generates an id when none supplied', () => {
    const { req, res } = fakeReqRes();
    expect(resolveRequestId(req, res)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('pagination helpers', () => {
  it('computes skip/take', () => {
    expect(toSkipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
  });
  it('builds a page envelope', () => {
    expect(pageOf([1, 2], 42, { page: 2, pageSize: 2 })).toEqual({
      items: [1, 2],
      total: 42,
      page: 2,
      pageSize: 2,
    });
  });
});

describe('SlugParamPipe', () => {
  const pipe = new SlugParamPipe('Team');
  it.each(['rage', 'team-1', 'a', 'x1-y2-z3'])('accepts %s', (s) => {
    expect(pipe.transform(s)).toBe(s);
  });
  it.each(['', 'UPPER', '-lead', 'trail-', 'a b', '../etc', 'a'.repeat(65), "x';--"])(
    'turns %j into 404',
    (s) => {
      expect(() => pipe.transform(s)).toThrow(NotFoundException);
    },
  );
  it('pattern is anchored', () => {
    expect(SLUG_PATTERN.test('ok\nbad')).toBe(false);
  });
});

describe('flattenValidationErrors', () => {
  it('flattens nested constraint messages with dotted paths', () => {
    const details = flattenValidationErrors([
      { property: 'page', constraints: { min: 'page must not be less than 1' }, children: [] },
      {
        property: 'filter',
        children: [{ property: 'status', constraints: { isIn: 'bad status' }, children: [] }],
      },
    ]);
    expect(details).toEqual([
      { field: 'page', message: 'page must not be less than 1' },
      { field: 'filter.status', message: 'bad status' },
    ]);
  });
});
