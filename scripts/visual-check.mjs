import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const outDir = path.resolve("qa-screenshots");

async function launchBrowser() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Try the next installed browser channel.
    }
  }
  return chromium.launch({ headless: true });
}

async function signIn(page) {
  page.on("console", (message) => console.log(`console:${message.type()}:${message.text()}`));
  page.on("pageerror", (error) => console.log(`pageerror:${error.message}`));
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Billing overview" }).waitFor({ timeout: 120000 });
  try {
    await page.getByText("Amounts").first().waitFor({ timeout: 120000 });
  } catch (error) {
    await page.screenshot({ fullPage: true, path: path.join(outDir, "dashboard-debug-timeout.png") });
    console.log(await page.locator("body").innerText());
    throw error;
  }
}

async function waitForAvatars(page) {
  await page.waitForFunction(
    () => {
      const images = [...document.querySelectorAll(".avatar-circle img")];
      return images.length === 0 || images.every((image) => image.complete && image.naturalWidth > 0);
    },
    null,
    { timeout: 30000 }
  ).catch(() => undefined);
}

const browser = await launchBrowser();
try {
  await fs.mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await signIn(page);
  await waitForAvatars(page);
  await page.screenshot({ fullPage: true, path: path.join(outDir, "dashboard-desktop.png") });

  await page.getByRole("button", { name: "People" }).click();
  await page.getByRole("heading", { name: "People performance" }).waitFor();
  await page.getByRole("heading", { name: "Top billable amounts" }).waitFor();
  await page.screenshot({ fullPage: true, path: path.join(outDir, "dashboard-people-desktop.png") });
  await page.getByRole("button", { name: "Clients" }).click();
  await page.getByRole("heading", { name: "Client reporting" }).waitFor();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(mobile);
  await waitForAvatars(mobile);
  await mobile.screenshot({ fullPage: true, path: path.join(outDir, "dashboard-mobile.png") });

  console.log("visual check passed");
} finally {
  await browser.close();
}
