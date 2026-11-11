const apiBase = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const siteBase = (process.env.SITE_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

async function check(label, url, validate) {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    const ok = validate(response, body);
    console.log(`${ok ? "PASS" : "FAIL"} ${label} (${response.status})`);
    return ok;
  } catch (error) {
    console.log(`FAIL ${label} (${error instanceof Error ? error.message : "request failed"})`);
    return false;
  }
}

(async () => {
  const results = await Promise.all([
    check("API liveness", `${apiBase}/health`, (r, body) => r.ok && body.includes('"status":"ok"')),
    check("API database readiness", `${apiBase}/ready`, (r, body) => r.ok && body.includes('"status":"ready"')),
    check("Web homepage", siteBase, (r, body) => r.ok && body.toLowerCase().includes("<html")),
  ]);
  console.log(`${results.filter(Boolean).length}/${results.length} smoke checks passed`);
  if (results.some((ok) => !ok)) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
