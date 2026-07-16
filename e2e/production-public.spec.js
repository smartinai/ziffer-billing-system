import { expect, test } from "@playwright/test";

const productionUrl = process.env.PRODUCTION_SMOKE_URL || "https://app.ziffer.lu";

test("production is ready and serves the login application", async ({ page, request }) => {
  const ready = await request.get(`${productionUrl}/api/health/ready`);
  expect(ready.status()).toBe(200);
  await expect(ready.json()).resolves.toMatchObject({ ok: true });

  await page.goto(productionUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
