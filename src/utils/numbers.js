const UNITS = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };

export function parseCompactNumber(input) {
  if (input === null || input === undefined) return null;
  const text = String(input).replace(/,/g, "").trim();
  if (!text || text === "-" || text === "—") return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  const suffix = text
    .slice(match.index + match[0].length)
    .trim()
    .toLowerCase();
  const unit = UNITS[suffix[0]];
  return Math.round(value * (unit ?? 1));
}

export function parseInteger(input) {
  if (input === null || input === undefined) return null;
  const match = String(input).replace(/,/g, "").match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

export function parseDecimal(input) {
  if (input === null || input === undefined) return null;
  const match = String(input).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : null;
}

export function parseCurrency(input) {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/[^\d]/g, "");
  return digits ? Number.parseInt(digits, 10) : null;
}

export function parseTrend(text, directionHint) {
  const source = String(text ?? "");
  const percent = parseDecimal(
    (source.match(/(-?\d+(?:\.\d+)?)\s*%/) ?? [])[1],
  );
  const delta = parseCompactNumber(
    (source.match(/\(([^)]+)\)/) ?? [])[1],
  );
  let direction = directionHint ?? "flat";
  if (percent === 0 && (delta === 0 || delta === null)) {
    direction = "flat";
  } else if (direction === "flat" && percent !== null) {
    if (percent > 0) direction = "up";
    else if (percent < 0) direction = "down";
  }
  return {
    percent,
    delta,
    direction,
    text: source.replace(/\s+/g, " ").trim(),
  };
}

export function parseHeight(raw) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const cm = parseInteger((text.match(/(\d{2,3})\s*cm/i) ?? [])[1]);
  const feetInches = text.match(/(\d)'(\d{1,2})/);
  return {
    cm,
    raw: text,
    imperial: feetInches
      ? `${feetInches[1]}'${feetInches[2]}"`
      : null,
  };
}

export function splitList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
