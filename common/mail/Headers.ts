export type HeaderField = { name: string; value: string };

/** Extract before normalization, so large bodies are never repeatedly copied. */
export function splitHeadersAndBody(
  source: string,
): {
  fields: HeaderField[];
  headers: Record<string, string>;
  body: string;
  headerBlock: string;
} {
  const boundary = /\r\n\r\n|\n\n|\r\r/.exec(source);
  const headerBlock = source.slice(0, boundary?.index ?? source.length);
  const body = boundary
    ? source.slice(boundary.index + boundary[0].length)
    : "";
  const fields: HeaderField[] = [];
  for (const line of headerBlock.split(/\r\n|\r|\n/)) {
    if (/^[ \t]/.test(line)) {
      if (fields.length) fields[fields.length - 1].value += ` ${line.trim()}`;
      continue;
    }
    const match = /^([^\s:]+):[ \t]*(.*)$/.exec(line);
    if (match) {
      fields.push({ name: match[1].toLowerCase(), value: match[2].trim() });
    }
  }
  const headers: Record<string, string> = Object.create(null);
  // Repeated fields remain available in order; display/MIME consistently use first.
  for (const field of fields) {
    if (!(field.name in headers)) headers[field.name] = field.value;
  }
  return { fields, headers, body, headerBlock };
}
