import { test, expect } from 'bun:test';
import {
  ElectrodeMask,
  elconId,
  elconToLabel,
  elconToPolarityLabel,
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

test('elconToPolarityLabel: forward — pos alfabetiskt mindre → ">"', () => {
  expect(elconToPolarityLabel([ElectrodeMask.A, ElectrodeMask.B])).toBe('A>B');
  expect(elconToPolarityLabel([ElectrodeMask.AC, ElectrodeMask.BD])).toBe('AC>BD');
  expect(elconToPolarityLabel([ElectrodeMask.A, ElectrodeMask.D])).toBe('A>D');
});

test('elconToPolarityLabel: reverse — pos alfabetiskt större → "<"', () => {
  expect(elconToPolarityLabel([ElectrodeMask.B, ElectrodeMask.A])).toBe('A<B');
  expect(elconToPolarityLabel([ElectrodeMask.BD, ElectrodeMask.AC])).toBe('AC<BD');
  expect(elconToPolarityLabel([ElectrodeMask.D, ElectrodeMask.A])).toBe('A<D');
});

test('elconToPolarityLabel: biphasic-flip pair hamnar i samma "lane"', () => {
  // Samma fysiska par AB → vänster sida alltid 'A' oavsett polaritet
  const forward = elconToPolarityLabel([ElectrodeMask.A, ElectrodeMask.B]);
  const reverse = elconToPolarityLabel([ElectrodeMask.B, ElectrodeMask.A]);
  expect(forward).toBe('A>B');
  expect(reverse).toBe('A<B');
  expect(forward.replace('>', '|')).toBe(reverse.replace('<', '|'));
});

test('elconToPolarityLabel: edge case — pos eller neg är 0', () => {
  expect(elconToPolarityLabel([ElectrodeMask.A, 0])).toBe('A>');
  expect(elconToPolarityLabel([0, ElectrodeMask.B])).toBe('>B');
  expect(elconToPolarityLabel([0, 0])).toBe('0>0');
});
