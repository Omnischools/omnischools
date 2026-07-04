/**
 * Drizzle schema barrel — one file per domain, re-exported here.
 * Phase 1 (cross-cutting): tenancy, identity, periods, audit, anomaly.
 * Later phases add: admissions, students, billing, attendance, score-ledger, boarding, ...
 */
export * from "./_enums";
export * from "./tenancy";
export * from "./identity";
export * from "./staff";
export * from "./periods";
export * from "./audit";
export * from "./anomaly";
export * from "./marketing";
export * from "./students";
export * from "./admissions";
export * from "./fees";
export * from "./billing";
export * from "./attendance";
export * from "./gradebook";
export * from "./timetable";
export * from "./comms";
export * from "./inbox";
export * from "./invites";
export * from "./books";
export * from "./whatsapp";
