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

async function openInlineEditor(page, buttonName, inputLabel, rowText = "") {
  const input = page.locator(`input[aria-label="${inputLabel}"]`);
  if (!await input.isVisible().catch(() => false)) {
    const scope = rowText
      ? page.getByRole("row").filter({ hasText: rowText })
      : page;
    const button = scope.getByRole("button", { name: buttonName });
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) await button.click();
  }
  await expect(input).toBeVisible();
  return input;
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

test("Teamwork sync shows progress and completion feedback", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

  const report = await page.request.get("/api/reporting/summary?startDate=2026-01-01&endDate=2026-08-03").then((response) => response.json());
  await page.route("**/api/reporting/refresh?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ contentType: "application/json", json: report, status: 200 });
  });

  await page.getByRole("button", { name: "Sync Teamwork" }).click();
  const dialog = page.getByRole("dialog", { name: "Sync in progress" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Fetching users, projects, tasks and current-year time entries");
  await expect(page.getByRole("button", { name: "Sync Teamwork" })).toBeDisabled();

  await expect(page.getByRole("dialog", { name: "Sync complete" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
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

test("AI task-name review provides compact bulk review controls", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Create New" }).click();
  await page.getByRole("combobox", { name: "Search clients" }).fill("E2E VAT Client");
  await page.getByRole("option", { name: "E2E VAT Client E2E VAT Client" }).click();
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByLabel("End date").fill("2026-01-31");
  await page.getByRole("button", { name: "Generate Document" }).click();
  let suggestionRequestCount = 0;
  await page.route("**/api/billing/quote-previews/*/task-name-suggestions", async (route) => {
    suggestionRequestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await route.fetch();
    const payload = await response.json();
    payload.suggestions[0] = {
      ...payload.suggestions[0],
      status: "unchanged",
      suggestedTaskName: payload.suggestions[0].currentTaskName,
      warning: "No suggestion was returned."
    };
    await route.fulfill({ response, json: payload });
  });
  await page.getByRole("button", { name: "Improve names with AI" }).click();

  const dialog = page.getByRole("dialog", { name: "Review task names" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("progressbar", { name: "Preparing task names" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Preparing…" })).toBeDisabled();
  await expect(dialog.locator(".task-name-review-columns")).toContainText("Original Teamwork name");
  await expect(dialog.getByRole("progressbar", { name: "Preparing task names" })).toHaveCount(0);
  await expect(dialog.locator(".task-name-review-columns")).toContainText("Invoice wording");
  const totalCount = await dialog.locator(".task-name-review-row").count();
  expect(totalCount).toBeGreaterThan(1);

  const noResponseRow = dialog.locator(".task-name-review-row").first();
  const noResponseWording = noResponseRow.getByRole("textbox", { name: "Invoice wording" });
  const noResponseSelection = noResponseRow.getByRole("checkbox", { name: /Use invoice wording/ });
  await expect(noResponseWording).toBeEnabled();
  await expect(noResponseSelection).toBeDisabled();
  await expect(noResponseRow).toContainText("Enter the invoice wording manually if needed.");

  const changedOnly = dialog.getByRole("checkbox", { name: /Show changed only/ });
  await changedOnly.check();
  await expect(dialog.locator(".task-name-review-row")).toHaveCount(totalCount - 1);
  await changedOnly.uncheck();

  await noResponseWording.fill("Manually entered invoice wording.");
  await expect(noResponseSelection).toBeEnabled();
  await expect(noResponseSelection).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Start over" })).toBeVisible();

  const completedRequestCount = suggestionRequestCount;
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Improve names with AI" }).click();
  await expect(dialog).toBeVisible();
  await expect(noResponseWording).toHaveValue("Manually entered invoice wording.");
  await expect(noResponseSelection).toBeChecked();
  await expect.poll(() => suggestionRequestCount).toBe(completedRequestCount);

  await dialog.getByRole("button", { name: "Deselect all" }).click();
  await expect(dialog.getByRole("button", { name: "Apply 0 task names" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Select all changes" }).click();
  await expect(dialog.getByRole("button", { name: new RegExp(`Apply ${totalCount} task names?`) })).toBeEnabled();

  await changedOnly.check();
  await expect(dialog.locator(".task-name-review-row")).toHaveCount(totalCount);
  await dialog.getByRole("button", { name: "How AI task names are processed" }).focus();
  await expect(dialog.getByRole("tooltip")).toBeVisible();

  await page.setViewportSize({ width: 412, height: 915 });
  await expect(dialog.locator(".task-name-review-columns")).toBeHidden();
  await expect(dialog.locator(".task-name-review-field-label").first()).toBeVisible();
  const mobileLayout = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(mobileLayout.clientWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  await expect(dialog.getByRole("button", { name: new RegExp(`Apply ${totalCount} task names?`) })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("people and projects reporting expose reconciled money, hours, percentages, and metric help", async ({ page }) => {
  await login(page);

  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.getByPlaceholder("Search people")).toBeVisible();
  const peopleTable = page.locator("table.reporting-classification-table").first();
  await expect(peopleTable.getByRole("button", { name: /^Teamwork:/ })).toBeVisible();
  await expect(peopleTable.getByRole("button", { name: /^Billable hours:/ })).toBeVisible();
  await expect(peopleTable.getByRole("button", { name: /^Non-billable hours:/ })).toBeVisible();
  await expect(peopleTable.getByRole("button", { name: /^Write-offs:/ })).toBeVisible();
  await expect(peopleTable.locator(".metric-stack").first().locator("strong")).toContainText("€");
  await expect(peopleTable.locator(".metric-percentage").first()).toHaveText(/%$/);

  const personRowButton = peopleTable.locator("tbody .project-row-button").first();
  await expect(personRowButton).toBeVisible();
  await personRowButton.click();
  await expect(peopleTable.locator("tbody .project-people-card")).toBeVisible();

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByPlaceholder("Search projects")).toBeVisible();
  const projectsTable = page.locator("table.reporting-classification-table").first();
  await expect(projectsTable.getByRole("button", { name: /^Teamwork:/ })).toBeVisible();
  await expect(projectsTable.getByRole("button", { name: /^Client:/ })).toBeVisible();
  await expect(projectsTable.getByRole("button", { name: /^Internal:/ })).toHaveCount(0);
  await expect(projectsTable.locator(".metric-percentage").first()).toHaveText(/%$/);
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
  test.setTimeout(120_000);
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
  const draftNumber = await page.getByLabel("Invoice number").inputValue();

  const editorSessionId = await page.evaluate(() => window.sessionStorage.getItem("ziffer.editorSession:v1"));
  const sameSessionCsrfResponse = await page.request.get("/api/auth/csrf");
  const sameSessionCsrf = (await sameSessionCsrfResponse.json()).csrfToken;
  const currentDraftResponse = await page.request.post(`/api/billing/quote-previews/${draftId}/editor-lock`, {
    headers: { "x-csrf-token": sameSessionCsrf },
    data: { editorSessionId }
  });
  const currentDraftPayload = await currentDraftResponse.json();
  const competingUpdate = await page.request.patch(`/api/billing/quote-previews/${draftId}`, {
    headers: { "x-csrf-token": sameSessionCsrf },
    data: {
      editorSessionId,
      reference: "Updated in another tab",
      version: currentDraftPayload.preview.version
    }
  });
  expect(competingUpdate.ok()).toBe(true);

  const conflictedRateInput = await openInlineEditor(
    page,
    "Edit Rate for VAT / Value added tax 2026",
    "Rate for VAT / Value added tax 2026",
    "overflow"
  );
  await conflictedRateInput.fill("450");
  await conflictedRateInput.press("Enter");
  const conflictAlert = page.getByRole("alert").filter({ hasText: "Newer draft version available" });
  await expect(conflictAlert).toContainText("another tab or window");
  await conflictAlert.getByRole("button", { name: "Reload latest" }).click();
  await expect(conflictAlert).toHaveCount(0);
  await expect(page.getByLabel("Document reference")).toHaveValue("Updated in another tab");

  const vatRateInput = await openInlineEditor(
    page,
    "Edit Rate for VAT / Value added tax 2026",
    "Rate for VAT / Value added tax 2026",
    "overflow"
  );
  await vatRateInput.fill("450");
  await vatRateInput.press("Enter");
  const vatDiscountInput = await openInlineEditor(
    page,
    "Edit Discount for VAT / Value added tax 2026",
    "Discount for VAT / Value added tax 2026",
    "overflow"
  );
  await vatDiscountInput.fill("12");
  await vatDiscountInput.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");
  const latestOwnerDraftResponse = await page.request.post(`/api/billing/quote-previews/${draftId}/editor-lock`, {
    headers: { "x-csrf-token": sameSessionCsrf },
    data: { editorSessionId }
  });
  expect(latestOwnerDraftResponse.ok()).toBe(true);
  const latestOwnerDraft = await latestOwnerDraftResponse.json();

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
  const blockedSuggestions = await secondPage.request.post(`/api/billing/quote-previews/${draftId}/task-name-suggestions`, {
    headers: { "x-csrf-token": csrfToken },
    data: {
      editorSessionId: "00000000-0000-4000-8000-000000000002",
      lineIds: ["00000000-0000-4000-8000-000000000099"],
      version: latestOwnerDraft.preview.version
    }
  });
  expect(blockedSuggestions.status()).toBe(423);
  await expect(blockedSuggestions.json()).resolves.toMatchObject({ code: "DRAFT_LOCKED" });
  await secondContext.close();

  const unbillableHoursInput = await openInlineEditor(
    page,
    "Edit Hours for E2E Unbillable Task",
    "Hours for E2E Unbillable Task"
  );
  await unbillableHoursInput.fill("0,5");
  await unbillableHoursInput.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");

  const taskBillableButton = page.getByRole("button", { name: "Mark task as billable: E2E Unbillable Task" });
  await expect(taskBillableButton).toBeVisible();
  await taskBillableButton.click();
  await expect(taskBillableButton).toHaveCount(0);
  const unbillableTaskRow = page.getByRole("row").filter({ hasText: "E2E Unbillable Task" });
  await expect(unbillableTaskRow).toContainText("0.5h");
  await expect(unbillableTaskRow).toContainText("Edited from 0.25h");

  const taskRateInput = await openInlineEditor(
    page,
    "Edit Rate for E2E Unbillable Task",
    "Rate for E2E Unbillable Task"
  );
  await taskRateInput.fill("275");
  await taskRateInput.press("Enter");
  await expect(unbillableTaskRow).toContainText("€275");
  await expect(unbillableTaskRow).toContainText("Edited from €300");

  await unbillableTaskRow.getByRole("button", { name: "Expand E2E Unbillable Task" }).click();
  const firstEntryRow = page.getByRole("row").filter({ hasText: "First unbillable entry" });
  const secondEntryRow = page.getByRole("row").filter({ hasText: "Second unbillable entry" });
  await expect(firstEntryRow).toContainText("€275");
  await expect(secondEntryRow).toContainText("€275");
  const firstEntryRateInput = await openInlineEditor(
    page,
    "Edit Rate for E2E Person: First unbillable entry",
    "Rate for E2E Person: First unbillable entry"
  );
  await firstEntryRateInput.fill("300");
  await firstEntryRateInput.press("Enter");
  await expect(firstEntryRow).toContainText("€300");
  await expect(secondEntryRow).toContainText("€275");
  await expect(secondEntryRow).toContainText("Edited from €300");
  await expect(unbillableTaskRow).toContainText("€285");
  const vatRowAfterBillability = page.getByRole("row").filter({ hasText: "VAT / Value added tax 2026" }).first();
  await expect(vatRowAfterBillability).toContainText("€450");
  await expect(vatRowAfterBillability).toContainText("12%");

  await page.getByRole("button", { name: "Add manual row" }).click();
  await page.getByLabel("Task name", { exact: true }).fill("E2E Manual Row");
  await page.getByLabel("Description", { exact: true }).fill("Deterministic manual fee");
  await page.getByLabel("Hours / Qty.", { exact: true }).fill("1");
  await page.getByLabel(/Rate \/ Fee/).fill("100");
  await page.getByLabel("Discount %", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("E2E Manual Row", { exact: true })).toBeVisible();
  await expect(page.locator(".quote-lines-table tbody tr.quote-task-row").first()).toContainText("E2E Manual Row");

  const manualRow = page.getByRole("row").filter({ hasText: "E2E Manual Row" });
  await expect(manualRow.getByText("€90", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Actions for E2E Unbillable Task" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Standardized service").selectOption({ label: "Filing / Correspondence" });
  const annualYearSelect = page.getByLabel("Annual invoice year");
  await expect(annualYearSelect).toHaveValue("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const rowEditorFooter = page.locator(".quote-line-edit-actions");
  await expect(rowEditorFooter.getByRole("alert")).toHaveText("Select an annual invoice year.");
  await expect(rowEditorFooter.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(rowEditorFooter.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(annualYearSelect).toBeFocused();
  await annualYearSelect.selectOption("2026");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const annualTaskRows = page.getByRole("row").filter({ hasText: "E2E Unbillable Task" });
  await expect(annualTaskRows.filter({ hasText: "pre-paid" })).toHaveCount(1);
  await expect(annualTaskRows.filter({ hasText: "overflow" })).toHaveCount(0);
  const annualCoverageSummary = page.getByLabel("Annual invoice coverage");
  await expect(annualCoverageSummary).toContainText("Filing / Correspondence");
  await expect(annualCoverageSummary).toContainText("2026");

  await page.getByRole("button", { name: "Actions for E2E Unbillable Task" }).first().click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Annual invoice year").selectOption("2027");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const zeroAllowanceTaskRow = page.getByRole("row").filter({ hasText: "E2E Unbillable Task" });
  await expect(zeroAllowanceTaskRow).toHaveCount(1);
  await expect(zeroAllowanceTaskRow).toContainText("overflow");
  await expect(zeroAllowanceTaskRow).not.toContainText("pre-paid");
  await expect(zeroAllowanceTaskRow).toContainText("€285");
  const annualOverflowSummary = page.getByLabel("Annual services to invoice");
  await expect(annualOverflowSummary).toContainText("Filing / Correspondence");
  await expect(annualOverflowSummary).toContainText("2027");
  await expect(page.getByRole("row").filter({ hasText: "E2E Manual Row" })).toContainText("€90");
  const vatRowAfterServiceRebuild = page.getByRole("row").filter({ hasText: "VAT / Value added tax 2026" }).first();
  await expect(vatRowAfterServiceRebuild).toContainText("€450");
  await expect(vatRowAfterServiceRebuild).toContainText("12%");

  const sourceTaskActions = page.getByRole("button", { name: "Actions for E2E Unbillable Task" });
  await sourceTaskActions.click();
  await expect(page.getByRole("menuitem", { name: "Mark unbillable" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Improve name with AI" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark task unbillable" })).toHaveCount(0);
  await sourceTaskActions.click();

  await page.getByRole("button", { name: "Improve names with AI" }).click();
  const taskNameDialog = page.getByRole("dialog", { name: "Review task names" });
  await expect(taskNameDialog).toBeVisible();
  await expect(taskNameDialog.getByText("E2E Unbillable Task", { exact: true })).toBeVisible();
  await expect(taskNameDialog.getByRole("button", { name: "Select all changes" })).toBeVisible();
  await taskNameDialog.getByRole("button", { name: "Deselect all" }).click();
  await expect(taskNameDialog.getByRole("button", { name: "Apply 0 task names" })).toBeDisabled();
  await taskNameDialog.getByRole("button", { name: "Select all changes" }).click();
  const changedSuggestionCount = await taskNameDialog.locator(".task-name-review-row").count();
  expect(changedSuggestionCount).toBeGreaterThan(0);
  await taskNameDialog.getByRole("checkbox", { name: /Show changed only/ }).check();
  await expect(taskNameDialog.locator(".task-name-review-row")).toHaveCount(changedSuggestionCount);
  const vatSuggestionRow = taskNameDialog.locator(".task-name-review-row").filter({ hasText: "VAT / Value added tax 2026" });
  for (const textarea of await vatSuggestionRow.locator("textarea").all()) {
    await textarea.fill("Review and preparation of the 2026 VAT filing.");
  }
  await taskNameDialog.getByRole("button", { name: /Apply \d+ task names/ }).click();
  await expect(taskNameDialog).toHaveCount(0);
  const renamedVatRow = page.locator("tr.quote-task-row").filter({ hasText: "Review and preparation of the 2026 VAT filing." }).first();
  await expect(renamedVatRow.locator(".quote-task-entry-count")).toHaveText("1");
  await expect(renamedVatRow.locator(".quote-task-name-text")).toHaveText("Review and preparation of the 2026 VAT filing.");
  await expect(renamedVatRow.locator(".quote-task-meta .quote-task-original-name")).toHaveText("VAT / Value added tax 2026");

  await page.getByRole("button", { name: "Actions for E2E Manual Row" }).click();
  await expect(page.getByRole("menuitem", { name: "Improve name with AI" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(page.getByText("E2E Manual Row", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  const draftsSection = page.getByRole("heading", { level: 2, name: "Drafts" })
    .locator("xpath=ancestor::section[contains(@class, 'draft-ledger-panel')]");
  const draftLedgerRow = draftsSection.getByRole("row").filter({ hasText: draftNumber });
  await expect(draftsSection.getByRole("columnheader", { name: "Created at" })).toBeVisible();
  await expect(draftLedgerRow.locator(".draft-created-at time")).toHaveText(/\d{1,2} [A-Z][a-z]{2} '\d{2}, \d{2}:\d{2}/);
  await expect(draftLedgerRow.locator(".draft-last-editor time")).toHaveText(/\d{1,2} [A-Z][a-z]{2} '\d{2}, \d{2}:\d{2}/);
  await page.getByRole("button", { name: "Create New" }).click();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark task as billable: E2E Unbillable Task" })).toHaveCount(0);
  const persistedRateTaskRow = page.getByRole("row").filter({ hasText: "E2E Unbillable Task" });
  await expect(persistedRateTaskRow).toContainText("€285");
  const persistedFirstEntryRow = page.locator("tr.quote-entry-row").filter({ hasText: "First unbillable entry" });
  if (!await persistedFirstEntryRow.isVisible().catch(() => false)) {
    await persistedRateTaskRow.locator("button.quote-task-expand").click();
  }
  await expect(persistedFirstEntryRow).toContainText("€300");
  await expect(page.locator("tr.quote-entry-row").filter({ hasText: "Second unbillable entry" })).toContainText("€275");
  await expect(page.getByText("E2E Manual Row", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Send to Xero" })).toHaveCount(0);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "Invoice preview" });
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.getByText("Amounts are tax exclusive")).toBeVisible();
  await expect(previewDialog.getByText("0.15", { exact: true })).toBeVisible();
  await expect(previewDialog.getByText(/Review and preparation of the 2026 VAT filing\./)).toBeVisible();
  await expect(previewDialog.getByRole("button", { name: "Send to Xero" })).toBeVisible();
  await previewDialog.getByLabel("Xero document type").selectOption("draft_quote");
  await expect(page.getByRole("dialog", { name: "Quote preview" })).toBeVisible();
  await page.getByRole("dialog", { name: "Quote preview" }).getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Archived" })).toBeVisible();
  const archivedSection = page.getByRole("heading", { level: 2, name: "Archived" })
    .locator("xpath=ancestor::section[contains(@class, 'draft-ledger-panel')]");
  const archivedRow = archivedSection.getByRole("row").filter({ hasText: draftNumber });
  await expect(archivedRow).toHaveCount(1);
  await archivedRow.getByRole("button", { name: "Restore" }).click();
  await expect(page).toHaveURL(new RegExp(`#billing-create-quote/${draftId}$`));
  await expect(page.getByText("0.15h", { exact: true }).first()).toBeVisible();
});

test("two unsent drafts may keep the same Xero document number", async ({ page }) => {
  await login(page);

  async function generateDraft() {
    await page.getByRole("button", { name: "Create New" }).click();
    await page.getByRole("combobox", { name: "Search clients" }).fill("E2E VAT Client");
    await page.getByRole("option", { name: "E2E VAT Client E2E VAT Client" }).click();
    await page.getByLabel("Start date").fill("2026-01-01");
    await page.getByLabel("End date").fill("2026-01-31");
    await page.getByRole("button", { name: "Generate Document" }).click();
    await expect(page).toHaveURL(/#billing-create-quote\/[0-9a-f-]+$/);
  }

  async function archiveDraft() {
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Invoice preview" });
    await expect(preview).toBeVisible();
    await preview.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
  }

  await generateDraft();
  const firstNumber = await page.getByLabel("Invoice number").inputValue();
  await archiveDraft();

  await generateDraft();
  const secondNumberInput = page.getByLabel("Invoice number");
  await secondNumberInput.fill(firstNumber);
  await secondNumberInput.blur();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(secondNumberInput).toHaveValue(firstNumber);
  await archiveDraft();
});
