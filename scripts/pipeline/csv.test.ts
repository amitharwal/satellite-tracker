import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
  it('parses LF-terminated rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('parses CRLF and a final row without a newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields with commas, newlines and escaped quotes', () => {
    expect(parseCsv('n,v\n"A, ""B""\nC",x\n"",y\n')).toEqual([
      ['n', 'v'],
      ['A, "B"\nC', 'x'],
      ['', 'y'],
    ]);
  });

  it('keeps empty unquoted fields', () => {
    expect(parseCsv('a,b,c\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['', '', ''],
    ]);
  });

  it('rejects ragged rows', () => {
    expect(() => parseCsv('a,b\n1,2,3\n')).toThrow(/row 2 has 3 fields/);
  });

  it('rejects blank lines inside the data', () => {
    expect(() => parseCsv('a,b\n\n1,2\n')).toThrow(/row 2/);
  });

  it('rejects stray and unterminated quotes', () => {
    expect(() => parseCsv('a,b\n1"x,2\n')).toThrow(/stray quote/);
    expect(() => parseCsv('a,b\n"1,2\n')).toThrow(/unterminated/);
    expect(() => parseCsv('a,b\n"1"x,2\n')).toThrow(/after closing quote/);
  });
});
