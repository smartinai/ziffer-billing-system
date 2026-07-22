import { expect, test } from "@playwright/test";

const adminEmail = "e2e-admin@ziffer.test";
const adminPassword = process.env.E2E_ADMIN_PASSWORD || "Ziffer-E2E-Admin-2026";

async function login(page, email = adminEmail, password = adminPassword) {
  await page.goto("/");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
}

test("administrator can view persisted operational health", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Operations" }).click();
  await expect(page.getByRole("heading", { name: "Operations", exact: true }).last()).toBeVisible();
  await expect(page.getByText("Database", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Production health", { exact: true })).toBeVisible();
});

test("billing user cannot access administrator operations API", async ({ page }) => {
  await login(page, "e2e-user@ziffer.test", process.env.E2E_USER_PASSWORD || "Ziffer-E2E-User-2026");
  const response = await page.request.get("/api/admin/operations");
  expect(response.status()).toBe(403);
  await expect(page.getByRole("button", { name: "Operations" })).toHaveCount(0);
});

test("logout and an expired browser session both return to sign in", async ({ context, page }) => {
  await login(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

  await login(page);
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("draft financial state, locking, task billing, archive, and restore are durable", async ({ browser, page }) => {
  await login(page);
  await page.getByRole("button", { name: "Create New" }).click();
  await page.getByRole("combobox", { name: "Search clients" }).fill("E2E VAT Client");
  await page.getByRole("option", { name: "E2E VAT Client E2E VAT Client" }).click();
  const startDate = page.getByLabel("Start date");
  const endDate = page.getByLabel("End date");
  await startDate.fill("2026-01-01");
  await endDate.fill("2026-01-31");
  await expect(startDate).toHaveValue("2026-01-01");
  await expect(endDate).toHaveValue("2026-01-31");
  await page.getByRole("button", { name: "Generate Document" }).click();
  await expect(page).toHaveURL(/#billing-create-quote\/[0-9a-f-]+$/);
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  const draftId = page.url().split("/").at(-1);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await login(secondPage, "e2e-user@ziffer.test", process.env.E2E_USER_PASSWORD || "Ziffer-E2E-User-2026");
  const csrfResponse = await secondPage.request.get("/api/auth/csrf");
  const { csrfToken } = await csrfResponse.json();
  const blockedLock = await secondPage.request.post(`/api/billing/quote-previews/${draftId}/editor-lock`, {
    headers: { "x-csrf-token": csrfToken },
    data: { editorSessionId: "00000000-0000-4000-8000-000000000002" }
  });
  expect(blockedLock.status()).toBe(423);
  await expect(blockedLock.json()).resolves.toMatchObject({ code: "DRAFT_LOCKED", details: { editorName: "E2E Administrator" } });
  await secondContext.close();

  const taskBillableButton = page.getByRole("button", { name: "Mark task as billable: E2E Unbillable Task" });
  await expect(taskBillableButton).toBeVisible();
  await taskBillableButton.click();
  await expect(taskBillableButton).toHaveCount(0);

  await page.getByRole("button", { name: "Add manual row" }).click();
  await page.getByLabel("Task name").fill("E2E Manual Row");
  await page.getByLabel("Description").fill("Deterministic manual fee");
  await page.getByLabel("Hours / Qty.").fill("1");
  await page.getByLabel(/Rate \/ Fee/).fill("100");
  await page.getByLabel("Discount %").fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("E2E Manual Row", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Actions for E2E Manual Row" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Hours / Qty.").fill("2");
  await page.getByLabel("Discount %").fill("25");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const manualRow = page.getByRole("row").filter({ hasText: "E2E Manual Row" });
  await expect(manualRow.getByText("€150", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await page.getByRole("button", { name: "Create New" }).click();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark task as billable: E2E Unbillable Task" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "E2E Manual Row" }).getByText("€150", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Archived" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page).toHaveURL(new RegExp(`#billing-create-quote/${draftId}$`));
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
});
