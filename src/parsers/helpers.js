export function cleanText(element) {
  return element.text().replace(/\s+/g, " ").trim();
}

export function absoluteUrl(baseUrl, href) {
  if (!href) return null;
  try {
    return new URL(href, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

export function queryParamFromHref(href, name) {
  if (!href) return null;
  try {
    const url = new URL(href, "https://www.futbin.com");
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export function firstNumber(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

const STAT_KEYS = {
  pac: "pace",
  sho: "shooting",
  pas: "passing",
  dri: "dribbling",
  def: "defending",
  phy: "physicality",
  div: "diving",
  han: "handling",
  kic: "kicking",
  ref: "reflexes",
  spd: "speed",
  pos: "positioning",
};

export function normalizeStatKey(label) {
  const key = String(label ?? "").trim().toLowerCase();
  return STAT_KEYS[key] ?? key;
}
