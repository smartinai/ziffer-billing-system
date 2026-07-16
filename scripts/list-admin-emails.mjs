import { listAdminEmails } from "../server/operationsRepository.js";

const emails = await listAdminEmails();
if (emails.length) process.stdout.write(`${emails.join("\n")}\n`);
