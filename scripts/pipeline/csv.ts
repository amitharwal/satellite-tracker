/**
 * Strict RFC 4180 CSV parser. Accepts LF or CRLF line endings and quoted
 * fields (with "" escapes). Throws on malformed quoting or ragged rows so a
 * format change upstream fails loudly instead of producing shifted columns.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStart = true;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldStart = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        const next = text[i + 1];
        if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
          throw new Error(`CSV: unexpected character after closing quote at offset ${i + 1}`);
        }
      } else {
        field += c;
      }
      i++;
      continue;
    }

    if (c === '"') {
      if (!fieldStart) throw new Error(`CSV: stray quote at offset ${i}`);
      inQuotes = true;
      fieldStart = false;
    } else if (c === ',') {
      endField();
    } else if (c === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (c === '\n') {
      endRow();
    } else {
      field += c;
      fieldStart = false;
    }
    i++;
  }

  if (inQuotes) throw new Error('CSV: unterminated quoted field');
  // Flush a final row that lacks a trailing newline.
  if (field !== '' || row.length > 0) endRow();

  const width = rows[0]?.length ?? 0;
  rows.forEach((r, n) => {
    if (r.length !== width) {
      throw new Error(`CSV: row ${n + 1} has ${r.length} fields, expected ${width}`);
    }
  });
  return rows;
}
