"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const request = require("supertest");
const { resolveSessionSecret } = require("../runtime-config");

process.env.APP_BASE_URL = "https://demo.example.test";
process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";

const app = require("../app");

test("home page renders with hardened response headers", async () => {
  const response = await request(app).get("/").expect(200);

  assert.match(response.text, /Node\.js demo with MS Entra ID SSO/);
  assert.match(response.text, /Not signed in/);
  assert.doesNotMatch(response.text, /class="auth-badge active"/);
  assert.match(
    response.text,
    /\/static\/css\/shared-ui\.css\?v=0f56e957183f/,
  );
  assert.match(
    response.headers["content-security-policy"],
    /default-src 'self'/,
  );
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.match(response.text, /SESSION_SECRET/);
  assert.doesNotMatch(response.text, /FLASK_SECRET_KEY/);
  assert.doesNotMatch(response.text, /Auto Sign-out/);
});

test("identity-empty Easy Auth headers do not start auto sign-out", async () => {
  const emptyPrincipal = Buffer.from(JSON.stringify({ claims: [] })).toString(
    "base64",
  );
  const response = await request(app)
    .get("/")
    .set("X-MS-CLIENT-PRINCIPAL", emptyPrincipal)
    .expect(200);

  assert.doesNotMatch(response.text, /Auto Sign-out/);
  assert.doesNotMatch(response.text, /id="idleCountdown"/);
});

test("Azure App Service startup rejects a missing session secret", () => {
  assert.throws(
    () =>
      resolveSessionSecret({
        NODE_ENV: "development",
        WEBSITE_SITE_NAME: "demo-app",
      }),
    /SESSION_SECRET must be configured/,
  );
});

test("Azure App Service startup rejects a short session secret", () => {
  assert.throws(
    () =>
      resolveSessionSecret({
        WEBSITE_SITE_NAME: "demo-app",
        SESSION_SECRET: "too-short",
      }),
    /SESSION_SECRET must be configured/,
  );
});

test("local development generates an ephemeral session secret", () => {
  const result = resolveSessionSecret({ NODE_ENV: "development" });

  assert.equal(result.configuredSecret, "");
  assert.match(result.sessionSecret, /^[a-f0-9]{64}$/);
});

test("health endpoint is fast, ready, and never redirects through auth", async () => {
  const startedAt = performance.now();
  const response = await request(app)
    .get("/health")
    .set("X-MS-CLIENT-PRINCIPAL", Buffer.from('{"claims":[]}').toString("base64"))
    .redirects(0)
    .expect(200);

  assert.deepEqual(response.body, { status: "ready" });
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.ok(performance.now() - startedAt < 250);

  const compatibilityResponse = await request(app)
    .get("/healthz")
    .redirects(0)
    .expect(200);
  assert.deepEqual(compatibilityResponse.body, { status: "ready" });
});

test("Easy Auth redirect uses the configured public origin", async () => {
  const response = await request(app)
    .get("/login/easyauth")
    .set("Host", "attacker.example")
    .expect(302);

  const location = new URL(
    response.headers.location,
    "https://demo.example.test",
  );
  assert.equal(location.pathname, "/.auth/login/aad");
  assert.equal(
    location.searchParams.get("post_login_redirect_uri"),
    "https://demo.example.test/profile/easyauth",
  );
});

test("unknown routes return a branded 404", async () => {
  const response = await request(app).get("/does-not-exist").expect(404);

  assert.match(response.text, /not_found/);
});

test("missing static assets return a branded 404 without a stack trace", async () => {
  const response = await request(app).get("/static/missing.svg").expect(404);

  assert.match(response.text, /not_found/);
  assert.doesNotMatch(response.text, /Error: ENOENT/);
});
