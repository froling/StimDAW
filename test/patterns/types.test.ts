import { test, expect } from 'bun:test';
import {
  ElectrodeMask,
  elconId,
  elconToLabel,
  isDisjoint,
  maskToString,
  maskUnion,
  uniqueElcons,
  type Elcon,
} from '../../src/patterns/types';

test('maskToString: enskilda elektroder', () => {
  expect(maskToString(ElectrodeMask.None)).toBe('None');
  expect(maskToString(ElectrodeMask.A)).toBe('A');
  expect(maskToString(ElectrodeMask.B)).toBe('B');
  expect(maskToString(ElectrodeMask.C)).toBe('C');
  expect(maskToString(ElectrodeMask.D)).toBe('D');
});

test('maskToString: kombinationer', () => {
  expect(maskToString(ElectrodeMask.AC)).toBe('AC');
  expect(maskToString(ElectrodeMask.BD)).toBe('BD');
  expect(maskToString(ElectrodeMask.AB)).toBe('AB');
  expect(maskToString(ElectrodeMask.ABCD)).toBe('ABCD');
});

test('elconToLabel: standardformat', () => {
  expect(elconToLabel([ElectrodeMask.A, ElectrodeMask.B])).toBe('A↔B');
  expect(elconToLabel([ElectrodeMask.AC, ElectrodeMask.BD])).toBe('AC↔BD');
  expect(elconToLabel([ElectrodeMask.D, ElectrodeMask.C])).toBe('D↔C');
});

test('isDisjoint: disjunkta par returnerar true', () => {
  expect(isDisjoint(ElectrodeMask.A, ElectrodeMask.B)).toBe(true);
  expect(isDisjoint(ElectrodeMask.AC, ElectrodeMask.BD)).toBe(true);
  expect(isDisjoint(0, 0)).toBe(true);
});

test('isDisjoint: överlappande par returnerar false', () => {
  expect(isDisjoint(ElectrodeMask.A, ElectrodeMask.A)).toBe(false);
  expect(isDisjoint(ElectrodeMask.AC, ElectrodeMask.AB)).toBe(false); // A delas
  expect(isDisjoint(ElectrodeMask.ABCD, ElectrodeMask.A)).toBe(false);
});

test('maskUnion: kombinerar masks', () => {
  expect(maskUnion(ElectrodeMask.A, ElectrodeMask.B)).toBe(ElectrodeMask.AB);
  expect(maskUnion(ElectrodeMask.AC, ElectrodeMask.BD)).toBe(ElectrodeMask.ABCD);
  expect(maskUnion(0, ElectrodeMask.A)).toBe(ElectrodeMask.A);
});

test('uniqueElcons: dedupe + bevara ordning', () => {
  const dup: Elcon[] = [
    [ElectrodeMask.A, ElectrodeMask.B],
    [ElectrodeMask.A, ElectrodeMask.B], // dup
    [ElectrodeMask.C, ElectrodeMask.D],
    [ElectrodeMask.A, ElectrodeMask.B], // dup
  ];
  const unique = uniqueElcons(dup);
  expect(unique.length).toBe(2);
  expect(unique[0]).toEqual([ElectrodeMask.A, ElectrodeMask.B]);
  expect(unique[1]).toEqual([ElectrodeMask.C, ElectrodeMask.D]);
});

test('elconId: stabil sträng-ID', () => {
  expect(elconId([ElectrodeMask.A, ElectrodeMask.B])).toBe('1-2');
  expect(elconId([ElectrodeMask.AC, ElectrodeMask.BD])).toBe('5-10');
  // Distinkt från reverse-elcon
  expect(elconId([ElectrodeMask.A, ElectrodeMask.B])).not.toBe(
    elconId([ElectrodeMask.B, ElectrodeMask.A]),
  );
});
