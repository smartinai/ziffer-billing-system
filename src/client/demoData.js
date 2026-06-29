import { buildReport } from "../shared/reportingMath.js";

const users = [
  { avatarUrl: "", email: "alex.rivera@example.test", id: "demo-u1", name: "Alex Rivera", userRate: 220 },
  { avatarUrl: "", email: "mira.santos@example.test", id: "demo-u2", name: "Mira Santos", userRate: 185 },
  { avatarUrl: "", email: "noah.chen@example.test", id: "demo-u3", name: "Noah Chen", userRate: 165 },
  { avatarUrl: "", email: "sara.klein@example.test", id: "demo-u4", name: "Sara Klein", userRate: 145 },
  { avatarUrl: "", email: "tom.okafor@example.test", id: "demo-u5", name: "Tom Okafor", userRate: 130 },
  { avatarUrl: "", email: "lina.meyer@example.test", id: "demo-u6", name: "Lina Meyer", userRate: 150 }
];

const projects = [
  { companyName: "Northstar Holdings", id: "demo-p1", name: "Northstar Holdings" },
  { companyName: "Blue Orchard SPF", id: "demo-p2", name: "Blue Orchard SPF" },
  { companyName: "Cedar Family Office", id: "demo-p3", name: "Cedar Family Office" },
  { companyName: "Quartz Ventures", id: "demo-p4", name: "Quartz Ventures" },
  { companyName: "Atlas Capital", id: "demo-p5", name: "Atlas Capital" },
  { companyName: "Ziffer Demo Internal", id: "demo-p6", name: "Ziffer Demo Internal" },
  { companyName: "", id: "demo-p7", name: "Alex Rivera" }
];

const monthProfiles = [
  { month: "01", scale: 0.82 },
  { month: "02", scale: 0.9 },
  { month: "03", scale: 1.08 },
  { month: "04", scale: 1 },
  { month: "05", scale: 1.14 },
  { month: "06", scale: 0.74 }
];

const projectProfiles = [
  { billable: true, day: 4, hours: 30, projectId: "demo-p1", userId: "demo-u1" },
  { billable: true, day: 8, hours: 26, projectId: "demo-p1", userId: "demo-u2" },
  { billable: true, day: 11, hours: 22, projectId: "demo-p2", userId: "demo-u2" },
  { billable: true, day: 15, hours: 18, projectId: "demo-p2", userId: "demo-u3" },
  { billable: true, day: 17, hours: 20, projectId: "demo-p3", userId: "demo-u4" },
  { billable: true, day: 20, hours: 14, projectId: "demo-p3", userId: "demo-u5" },
  { billable: true, day: 22, hours: 16, projectId: "demo-p4", userId: "demo-u1" },
  { billable: true, day: 24, hours: 12, projectId: "demo-p5", userId: "demo-u6" },
  { billable: false, day: 26, hours: 10, projectId: "demo-p6", userId: "demo-u3" },
  { billable: false, day: 27, hours: 8, projectId: "demo-p6", userId: "demo-u5" },
  { billable: true, day: 28, hours: 9, projectId: "demo-p7", userId: "demo-u1" }
];

function entryDate(month, day) {
  return `2026-${month}-${String(day).padStart(2, "0")}`;
}

const timeEntries = monthProfiles.flatMap(({ month, scale }, monthIndex) =>
  projectProfiles.map((profile, profileIndex) => ({
    date: entryDate(month, profile.day),
    id: `demo-entry-${monthIndex + 1}-${profileIndex + 1}`,
    isBillable: profile.billable,
    minutes: Math.round(profile.hours * scale * 60),
    projectId: profile.projectId,
    userId: profile.userId
  }))
);

export function getDemoReport(range) {
  const report = buildReport({
    currency: "EUR",
    endDate: range.endDate,
    projects,
    startDate: range.startDate,
    timeEntries,
    users
  });

  return {
    ...report,
    fromCache: false,
    fromStorage: false,
    metadata: {
      ...report.metadata,
      api: { pagesFetched: 0, partial: false, warnings: [] },
      fetchedAt: "2026-06-18T09:00:00.000Z",
      source: { configured: false, demo: true },
      storage: {
        coverageEnd: "2026-06-30",
        coverageStart: "2026-01-01",
        mode: "demo",
        storeSyncedAt: "2026-06-18T09:00:00.000Z",
        warnings: []
      }
    }
  };
}
