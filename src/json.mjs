// Strict JSON, including duplicate-key rejection. No eval or dependencies.
function parseInternal(text) {
  let i = 0;
  function fail() { throw new Error('Malformed JSON or duplicate key'); }
  function ws() { while (' \t\n\r'.includes(text[i]) && i < text.length) i++; }
  function value(depth = 0) {
    if (depth > 64) fail();
    ws();
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') return JSON.parse(text.slice(start, i));
      }
      fail();
    }
    if (c === '{' || c === '[') {
      i++;
      const object = c === '{', end = object ? '}' : ']';
      const result = object ? Object.create(null) : [];
      ws();
      if (text[i] === end) { i++; return result; }
      while (i < text.length) {
        if (object) {
          ws(); if (text[i] !== '"') fail();
          const key = value(depth + 1);
          ws(); if (text[i++] !== ':' || Object.hasOwn(result, key)) fail();
          result[key] = value(depth + 1);
        } else result.push(value(depth + 1));
        ws();
        if (text[i] === end) { i++; return result; }
        if (text[i++] !== ',') fail();
      }
      fail();
    }
    const match = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) fail();
    i += match[0].length;
    const result = JSON.parse(match[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) fail();
    return result;
  }
  const result = value();
  ws(); if (i !== text.length) fail();
  return result;
}

export function parseJSON(text) {
  try { return parseInternal(text); }
  catch { throw new Error("Malformed JSON or duplicate key"); }
}
