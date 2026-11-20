/**
 * Lenient JSON parsing for LLM output.
 * Models sometimes return JSON wrapped in prose/code fences, with trailing
 * commas, or truncated mid-stream when they hit a token limit. This module
 * extracts the first JSON value and repairs common damage before parsing.
 */

/**
 * Close unterminated strings and brackets.
 * When `cutIncomplete` is set, also drop a trailing element that was cut off
 * mid-stream (keeps only up to the last complete element).
 */
export function repairJson(input: string, cutIncomplete = false): string {
  // Remove trailing commas before a closing bracket: {"a":1,} -> {"a":1}
  let t = input.replace(/,\s*([\]}])/g, "$1");

  if (cutIncomplete) {
    // Find the end of the last complete element (a comma or closing bracket at any depth).
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    let lastGood = 0;
    for (let i = 0; i < t.length; i++) {
      const c = t[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") {
        stack.pop();
        lastGood = i + 1;
      } else if (c === "," && stack.length > 0) lastGood = i;
    }
    if (inStr || stack.length > 0) t = t.slice(0, lastGood);
  }

  // Scan the kept portion to learn what is still open.
  const open: string[] = [];
  let inS = false;
  let e2 = false;
  for (const c of t) {
    if (inS) {
      if (e2) e2 = false;
      else if (c === "\\") e2 = true;
      else if (c === '"') inS = false;
      continue;
    }
    if (c === '"') inS = true;
    else if (c === "{" || c === "[") open.push(c);
    else if (c === "}" || c === "]") open.pop();
  }
  if (inS) t += '"';
  while (open.length) t += open.pop() === "{" ? "}" : "]";
  return t;
}

/** Extract the first JSON object/array from model text and parse it, repairing if needed. */
export function parseJsonLenient<T>(text: string): T {
  const clean = text.replace(/```(?:json)?/gi, "").trim();
  const start = clean.search(/[[{]/);
  if (start < 0) throw new Error("Model did not return JSON");
  const open = clean[start]!;
  const close = open === "{" ? "}" : "]";
  const end = clean.lastIndexOf(close);
  const slice = end > start ? clean.slice(start, end + 1) : clean.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    // First try just closing what is open (keeps a complete trailing scalar),
    // then fall back to dropping the incomplete trailing element.
    try {
      return JSON.parse(repairJson(slice)) as T;
    } catch {
      try {
        return JSON.parse(repairJson(slice, true)) as T;
      } catch {
        const fixed = sanitizeJson(slice);
        try {
          return JSON.parse(repairJson(fixed)) as T;
        } catch {
          return JSON.parse(repairJson(fixed, true)) as T;
        }
      }
    }
  }
}

/**
 * Fix common model mistakes inside otherwise-complete JSON:
 * unescaped inner quotes, raw newlines/tabs in strings, and missing commas
 * between properties or array elements.
 */
export function sanitizeJson(input: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  let valueEnded = false; // last significant token closed a value
  const n = input.length;
  for (let i = 0; i < n; i++) {
    const c = input[i]!;
    if (inStr) {
      if (esc) { esc = false; out += c; continue; }
      if (c === "\\") { esc = true; out += c; continue; }
      if (c === "\n") { out += "\\n"; continue; }
      if (c === "\r") { out += "\\r"; continue; }
      if (c === "\t") { out += "\\t"; continue; }
      if (c === '"') {
        let j = i + 1;
        let nl = false;
        while (j < n && /\s/.test(input[j]!)) { if (input[j] === "\n") nl = true; j++; }
        const nx = input[j];
        if (nx === undefined || nx === "," || nx === "}" || nx === "]" || nx === ":" || (nl && (nx === '"' || nx === "{" || nx === "["))) {
          inStr = false; valueEnded = true; out += c;
        } else out += '\\"';
        continue;
      }
      out += c;
      continue;
    }
    if (/\s/.test(c)) { out += c; continue; }
    if (valueEnded && (c === '"' || c === "{" || c === "[")) out += ",";
    if (c === '"') { inStr = true; valueEnded = false; out += c; continue; }
    if (c === "}" || c === "]") { valueEnded = true; out += c; continue; }
    if (c === "," || c === ":" || c === "{" || c === "[") { valueEnded = false; out += c; continue; }
    // literal (number/true/false/null): consume it
    let j = i;
    while (j < n && /[^\s,:{}[\]"]/.test(input[j]!)) j++;
    out += input.slice(i, j);
    i = j - 1;
    valueEnded = true;
  }
  return out;
}
