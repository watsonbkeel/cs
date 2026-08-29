function normalizeGameUrl(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/i.test(normalized)) return normalized;
  if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/[^\s]*)?$/i.test(normalized)) return normalized;
  return '';
}

module.exports = {
  normalizeGameUrl,
};
