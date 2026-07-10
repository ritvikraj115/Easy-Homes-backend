const fs = require('fs/promises');
const path = require('path');

const CONTENT_FILE = path.join(__dirname, '..', 'data', 'kalpavruksha-content.json');

const DEFAULT_SITE_IMAGES = [
  { id: 'main-gate', label: 'Main gate', imageUrl: '', alt: '' },
  { id: 'compound-wall', label: 'Compound wall', imageUrl: '', alt: '' },
  { id: 'clubhouse-lawn', label: 'Clubhouse lawn', imageUrl: '', alt: '' },
  { id: 'seating-pavilion', label: 'Seating pavilion', imageUrl: '', alt: '' },
];

function normalizeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSiteImages(value) {
  if (!Array.isArray(value)) return DEFAULT_SITE_IMAGES;

  return value.slice(0, 12).map((item, index) => ({
    id: normalizeText(item?.id, 64) || `site-image-${index + 1}`,
    label: normalizeText(item?.label, 80) || `Site image ${index + 1}`,
    imageUrl: normalizeText(item?.imageUrl, 2048),
    alt: normalizeText(item?.alt, 180),
  }));
}

function normalizeContent(value) {
  return {
    siteImages: normalizeSiteImages(value?.siteImages),
  };
}

async function ensureStoreFile() {
  try {
    await fs.access(CONTENT_FILE);
  } catch {
    await fs.mkdir(path.dirname(CONTENT_FILE), { recursive: true });
    await fs.writeFile(CONTENT_FILE, `${JSON.stringify(normalizeContent({}), null, 2)}\n`, 'utf8');
  }
}

async function readKalpavrukshaContent() {
  await ensureStoreFile();
  const raw = await fs.readFile(CONTENT_FILE, 'utf8');
  if (!raw.trim()) return normalizeContent({});
  return normalizeContent(JSON.parse(raw));
}

async function writeKalpavrukshaContent(content) {
  await ensureStoreFile();
  const normalized = normalizeContent(content);
  await fs.writeFile(CONTENT_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return normalized;
}

module.exports = {
  CONTENT_FILE,
  DEFAULT_SITE_IMAGES,
  normalizeContent,
  readKalpavrukshaContent,
  writeKalpavrukshaContent,
};
