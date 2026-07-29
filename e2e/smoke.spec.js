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

test("client display-name overrides appear in billing and reporting without changing the Teamwork project", async ({ page }) => {
  await login(page);
  const csrf = await page.request.get("/api/auth/csrf").then((response) => response.json());
  const clients = await page.request.get("/api/billing/clients").then((response) => response.json());
  const initialReport = await page.request.get("/api/reporting/summary?startDate=2026-01-01&endDate=2026-07-22").then((response) => response.json());
  const reportedProjectIds = new Set(initialReport.byProject.map((project) => String(project.id)));
  const client = clients.clients.find((item) => item.teamworkProjectId === "e2e-project")
    || clients.clients.find((item) => reportedProjectIds.has(String(item.teamworkProjectId)));
  expect(client).toBeTruthy();

  const renamed = "E2E VAT Client Display Override";
  try {
    const update = await page.request.patch(`/api/billing/clients/${client.id}`, {
      data: { ...client, displayName: renamed, mariaRole: "director" },
      headers: { "x-csrf-token": csrf.csrfToken }
    });
    expect(update.ok()).toBeTruthy();
    await expect(update.json()).resolves.toMatchObject({
      client: {
        displayName: renamed,
        mariaRole: "director",
        teamworkProjectId: client.teamworkProjectId,
        teamworkProjectName: client.teamworkProjectName
      }
    });

    const report = await page.request.get("/api/reporting/summary?startDate=2026-01-01&endDate=2026-07-22").then((response) => response.json());
    expect(report.byProject.find((project) => String(project.id) === String(client.teamworkProjectId))?.name).toBe(renamed);

  } finally {
    const restore = await page.request.patch(`/api/billing/clients/${client.id}`, {
      data: client,
      headers: { "x-csrf-token": csrf.csrfToken }
    });
    expect(restore.ok()).toBeTruthy();
  }

  await page.goto("/#billing-clients");
  await page.getByPlaceholder("Search clients").fill(client.displayName);
  const clientRow = page.locator("tr").filter({ hasText: client.displayName });
  await clientRow.click();
  await page.getByLabel("Maria's role").selectOption("director");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(clientRow).toContainText("Director (€300/hour)");

  const restoreRole = await page.request.patch(`/api/billing/clients/${client.id}`, {
    data: client,
    headers: { "x-csrf-token": csrf.csrfToken }
  });
  expect(restoreRole.ok()).toBeTruthy();
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

  await page.getByRole("button", { name: "Edit Hours for E2E Unbillable Task" }).click();
  await page.getByLabel("Hours for E2E Unbillable Task").fill("0,5");
  await page.getByLabel("Hours for E2E Unbillable Task").press("Enter");
  await expect(page.getByText(/Edited from .*h/).first()).toBeVisible();

  await page.getByRole("button", { name: "Add manual row" }).click();
  await page.getByLabel("Task name", { exact: true }).fill("E2E Manual Row");
  await page.getByLabel("Description", { exact: true }).fill("Deterministic manual fee");
  await page.getByLabel("Hours / Qty.", { exact: true }).fill("1");
  await page.getByLabel(/Rate \/ Fee/).fill("100");
  await page.getByLabel("Discount %", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("E2E Manual Row", { exact: true })).toBeVisible();
  await expect(page.locator(".quote-lines-table tbody tr.quote-task-row").first()).toContainText("E2E Manual Row");

  await page.getByRole("button", { name: "Edit Task name for E2E Manual Row" }).click();
  await page.getByLabel("Task name for E2E Manual Row").fill("E2E Inline Row");
  await page.getByLabel("Task name for E2E Manual Row").press("Enter");
  await expect(page.getByText("E2E Inline Row", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit Hours for E2E Inline Row" }).click();
  await page.getByLabel("Hours for E2E Inline Row").fill("2,5");
  await page.getByLabel("Hours for E2E Inline Row").press("Tab");
  const inlineRateButton = page.getByRole("button", { name: "Edit Rate for E2E Inline Row" });
  await expect(inlineRateButton).toBeVisible();
  await inlineRateButton.click();
  const inlineRateInput = page.locator('input[aria-label="Rate for E2E Inline Row"]');
  await inlineRateInput.fill("120");
  const rateSave = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
      && response.url().includes("/api/billing/quote-previews/")
      && !response.url().includes("/editor-lock")
  );
  await inlineRateInput.press("Enter");
  await rateSave;
  await expect(inlineRateInput).toHaveCount(0);
  const discountButton = page.getByRole("button", { name: "Edit Discount for E2E Inline Row" });
  await expect(discountButton).toBeEnabled();
  await discountButton.click();
  const inlineDiscountInput = page.locator('input[aria-label="Discount for E2E Inline Row"]');
  await inlineDiscountInput.fill("20");
  await inlineDiscountInput.press("Enter");
  await expect(page.getByRole("row").filter({ hasText: "E2E Inline Row" }).getByText(/240/, { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Actions for E2E Inline Row" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Hours / Qty.", { exact: true }).fill("2");
  await page.getByLabel("Discount %", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const manualRow = page.getByRole("row").filter({ hasText: "E2E Inline Row" });
  await expect(manualRow.getByText("€180", { exact: true })).toBeVisible();

  const sourceTaskActions = page.getByRole("button", { name: "Actions for E2E Unbillable Task" });
  await sourceTaskActions.click();
  await expect(page.getByRole("menuitem", { name: "Mark unbillable" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark task unbillable" })).toHaveCount(0);
  await sourceTaskActions.click();

  await page.getByRole("button", { name: "Actions for E2E Inline Row" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(page.getByText("E2E Inline Row", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await page.getByRole("button", { name: "Create New" }).click();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark task as billable: E2E Unbillable Task" })).toHaveCount(0);
  await expect(page.getByText("E2E Inline Row", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Send to Xero" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "Invoice preview" });
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.getByText("Amounts are tax exclusive")).toBeVisible();
  await expect(previewDialog.getByText("0.15", { exact: true })).toBeVisible();
  await expect(previewDialog.getByRole("button", { name: "Send to Xero" })).toBeVisible();
  await previewDialog.getByLabel("Xero document type").selectOption("draft_quote");
  await expect(page.getByRole("dialog", { name: "Quote preview" })).toBeVisible();
  await page.getByRole("dialog", { name: "Quote preview" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Archived" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page).toHaveURL(new RegExp(`#billing-create-quote/${draftId}$`));
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
});
