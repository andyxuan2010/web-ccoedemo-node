"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { resolveSessionSecret } = require("../runtime-config");

process.env.APP_BASE_URL = "https://demo.example.test";
process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";

const app = require("../app");

test("home page renders with hardened response headers", async () => {
  const response = await request(app).get("/").expect(200);

  assert.match(response.text, /Node\.js demo with MS Entra ID SSO/);
  assert.match(
    response.headers["content-security-policy"],
    /default-src 'self'/,
  );
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
  assert.match(response.text, /SESSION_SECRET/);
  assert.doesNotMatch(response.text, /FLASK_SECRET_KEY/);
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

test("health endpoint reports ready without exposing configuration", async () => {
  const response = await request(app).get("/healthz").expect(200);

  assert.deepEqual(response.body, { status: "ok" });
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
