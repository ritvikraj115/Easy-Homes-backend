const fs = require('fs/promises');
const path = require('path');

const PROPERTIES_FILE = path.join(__dirname, '..', 'data', 'properties.json');

async function ensureStoreFile() {
  try {
    await fs.access(PROPERTIES_FILE);
  } catch {
    await fs.mkdir(path.dirname(PROPERTIES_FILE), { recursive: true });
    await fs.writeFile(PROPERTIES_FILE, '[]', 'utf8');
  }
}

async function readProperties() {
  await ensureStoreFile();
  const raw = await fs.readFile(PROPERTIES_FILE, 'utf8');

  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeProperties(properties) {
  await ensureStoreFile();

  const safe = Array.isArray(properties) ? properties : [];
  const json = `${JSON.stringify(safe, null, 2)}\n`;
  await fs.writeFile(PROPERTIES_FILE, json, 'utf8');
}

module.exports = {
  readProperties,
  writeProperties,
  PROPERTIES_FILE,
};
