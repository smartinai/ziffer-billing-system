import { fetchXeroReferenceData, getXeroConnectionStatus } from "../server/xeroClient.js";

const expectedTenantId = String(process.env.XERO_DEMO_TENANT_ID || "").trim();
if (!expectedTenantId) throw new Error("XERO_DEMO_TENANT_ID is required.");

const status = await getXeroConnectionStatus();
if (!status.connected) throw new Error("The protected Xero demo connection is not connected.");
if (status.tenantId !== expectedTenantId) throw new Error("Refusing to test: the connected tenant is not the approved Xero demo tenant.");
if (!/demo/i.test(status.tenantName || "")) throw new Error("Refusing to test: the approved tenant name does not contain 'demo'.");

const reference = await fetchXeroReferenceData();
console.log(`Xero demo connection verified for ${status.tenantName}; fetched ${reference.accounts?.length || 0} accounts and ${reference.taxRates?.length || 0} tax rates.`);
