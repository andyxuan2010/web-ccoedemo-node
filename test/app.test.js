"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

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
