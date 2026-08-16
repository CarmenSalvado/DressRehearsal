import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOrigin, createAccessToken, verifyAccessCode, verifyAccessToken } from "../lib/auth.ts";

process.env.SESSION_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
process.env.DEMO_ACCESS_CODE = "stage-door";

test("access tokens are signed and expire", () => {
  const now = 1_700_000_000_000;
  const token = createAccessToken(now);
  assert.equal(verifyAccessToken(token, now + 1), true);
  assert.equal(verifyAccessToken(`${token}x`, now + 1), false);
  assert.equal(verifyAccessToken(token, now + 2 * 60 * 60 * 1000 + 1), false);
});

test("access code comparison accepts only the configured code", () => {
  assert.equal(verifyAccessCode("stage-door"), true);
  assert.equal(verifyAccessCode("wrong"), false);
  assert.equal(verifyAccessCode(null), false);
});

test("origin validation uses the received host", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("http://localhost/internal", {
    headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
  })));
  assert.throws(() => assertSameOrigin(new Request("http://localhost/internal", {
    headers: { host: "127.0.0.1:3000", origin: "https://attacker.test" },
  })));
});
