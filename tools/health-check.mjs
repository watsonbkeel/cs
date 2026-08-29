const url = process.env.HEALTH_URL || 'http://127.0.0.1:7460/healthz';
const timeout = Number(process.env.HEALTH_TIMEOUT_MS || 5000);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeout);
try {
  const response = await fetch(url, { signal: controller.signal });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(`unhealthy response: ${response.status}`);
  console.log(JSON.stringify(body));
} finally {
  clearTimeout(timer);
}
