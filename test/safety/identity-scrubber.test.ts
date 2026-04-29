import { test, expect } from 'bun:test';
import { scrubIdentity, scrubObject } from '../../src/safety/identity-scrubber';

test('scrubIdentity: macOS home', () => {
  expect(scrubIdentity('/Users/alice/projects/foo')).toBe('<HOME>/projects/foo');
});

test('scrubIdentity: Linux home', () => {
  expect(scrubIdentity('/home/bob/work')).toBe('<HOME>/work');
});

test('scrubIdentity: Windows backslash home', () => {
  expect(scrubIdentity('C:\\Users\\hakan\\PrivDev\\StimDAW')).toBe('<HOME>\\PrivDev\\StimDAW');
});

test('scrubIdentity: Windows forward-slash home (Git Bash style)', () => {
  expect(scrubIdentity('C:/Users/hakan/PrivDev')).toBe('<HOME>/PrivDev');
});

test('scrubIdentity: env var refs', () => {
  expect(scrubIdentity('cd %USERPROFILE% then')).toBe('cd <HOME> then');
  expect(scrubIdentity('hello %USERNAME%!')).toBe('hello <USER>!');
});

test('scrubIdentity: passes through clean strings', () => {
  expect(scrubIdentity('relative/path')).toBe('relative/path');
  expect(scrubIdentity('no paths here')).toBe('no paths here');
});

test('scrubObject: nested object with paths', () => {
  const input = {
    file: '/Users/alice/data.json',
    meta: {
      cwd: 'C:\\Users\\hakan\\dev',
      name: 'StimDAW',
    },
    history: ['/home/bob/old', 'normal text'],
  };
  const result = scrubObject(input);
  expect(result).toEqual({
    file: '<HOME>/data.json',
    meta: {
      cwd: '<HOME>\\dev',
      name: 'StimDAW',
    },
    history: ['<HOME>/old', 'normal text'],
  });
});

test('scrubObject: preserves non-string types', () => {
  const input = { count: 42, ratio: 1.5, on: true, none: null, missing: undefined };
  expect(scrubObject(input)).toEqual(input);
});
