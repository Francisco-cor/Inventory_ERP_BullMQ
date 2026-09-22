import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { requireAdmin } from "./plugins/auth.js";

const originalApiKey = process.env.ADMIN_API_KEY;
const originalJwtSecret = process.env.JWT_SECRET;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = originalApiKey;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

async function buildApp() {
  const app = Fastify();
  app.get("/admin/docs", { preHandler: requireAdmin }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe("admin authentication", () => {
  it("rejects requests without the configured API key", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    delete process.env.JWT_SECRET;
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/admin/docs" });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts the configured API key as the admin actor", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    delete process.env.JWT_SECRET;
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/admin/docs",
      headers: { "x-api-key": "test-admin-key" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
