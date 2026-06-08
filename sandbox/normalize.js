function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeContent(value) {
  return typeof value === "string" ? value : "";
}

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

module.exports = {
  nonNegativeInteger,
  normalizeContent,
  normalizeInteger,
  normalizeText,
  positiveInteger
};
