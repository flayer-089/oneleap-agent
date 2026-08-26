const countries = require('../config/countries.json');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchText(fieldText, regionTerms) {
  const t = normalize(fieldText);
  if (!t) return false;

  const tokens = t.split(' ');
  const tokenSet = new Set(tokens);

  for (const term of regionTerms) {
    const nt = normalize(term);
    if (!nt) continue;

    if (nt.length <= 3) {
      // short codes like "us", "uk", "sa", "ae", "usa", "uae" -> whole-token only
      if (tokenSet.has(nt)) return true;
    } else {
      // full country names -> substring
      if (t.includes(nt)) return true;
    }
  }

  return false;
}

function isAllowed(country, companyHQ) {
  const allowed = [];
  for (const key of Object.keys(countries.regions)) {
    allowed.push(...countries.regions[key]);
  }

  const hasCountry = !!normalize(country);
  const hasHQ = !!normalize(companyHQ);

  // Skip ONLY when a present field falls outside the allowed regions.
  // Missing fields are ignored; if both are missing, accept.
  if (hasCountry && !matchText(country, allowed)) return false;
  if (hasHQ && !matchText(companyHQ, allowed)) return false;
  return true;
}

function whichRegions(country, companyHQ) {
  const found = [];
  const fields = [country, companyHQ];
  for (const [region, terms] of Object.entries(countries.regions)) {
    if (fields.some((f) => matchText(f, terms))) {
      found.push(region);
    }
  }
  return found;
}

module.exports = { isAllowed, whichRegions, normalize };
