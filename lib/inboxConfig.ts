/**
 * Inbox Configuration for CX Insights Dashboard
 * Maps inbox names to their IDs and categories
 */

export type InboxCategory = "CR" | "BO";

export interface InboxConfig {
  id: string;
  name: string;
  category: InboxCategory;
}

// Case Resolution inboxes (12 total)
const CR_INBOXES: InboxConfig[] = [
  { id: "6813596", name: "CR - CFD: Trading Ethics Email Support", category: "CR" },
  { id: "6881232", name: "CR - Risky Traders", category: "CR" },
  { id: "8129681", name: "CR - KYC Cases", category: "CR" },
  { id: "8129683", name: "CR - TIP Cases", category: "CR" },
  { id: "8129690", name: "CR - CID Cases", category: "CR" },
  { id: "8129692", name: "CR - HyperActivity Cases", category: "CR" },
  { id: "8129872", name: "CR - Interview", category: "CR" },
  { id: "8129873", name: "CR - High PNL PTR", category: "CR" },
  { id: "8129908", name: "CR - Copy/Hedge Cases", category: "CR" },
  { id: "8301015", name: "CR - Futures: Trading Ethics Email Support", category: "CR" },
  { id: "8702529", name: "CR - Margin Cases", category: "CR" },
  { id: "8812898", name: "CR - Permanent Termination", category: "CR" },
  { id: "9246265", name: "CR - EUROPE", category: "CR" },
  { id: "9821239", name: "CR - DTP Cases", category: "CR" },
];

// Business Operations inboxes (1 total)
const BO_INBOXES: InboxConfig[] = [
  { id: "8314220", name: "Business Operations", category: "BO" },
];

// All monitored inboxes
export const ALL_INBOXES = [...CR_INBOXES, ...BO_INBOXES];

// Helper functions for easier access
export const getCRInboxIds = (): string[] => CR_INBOXES.map((inbox) => inbox.id);
export const getBOInboxIds = (): string[] => BO_INBOXES.map((inbox) => inbox.id);
export const getAllInboxIds = (): string[] => ALL_INBOXES.map((inbox) => inbox.id);

export const getInboxById = (id: string): InboxConfig | undefined =>
  ALL_INBOXES.find((inbox) => inbox.id === id);

export const getInboxsByCategory = (category: InboxCategory): InboxConfig[] =>
  ALL_INBOXES.filter((inbox) => inbox.category === category);

// Statistics
export const INBOX_STATS = {
  totalInboxes: ALL_INBOXES.length,
  crInboxes: CR_INBOXES.length,
  boInboxes: BO_INBOXES.length,
};

const inboxConfigExport = {
  CR_INBOXES,
  BO_INBOXES,
  ALL_INBOXES,
  getCRInboxIds,
  getBOInboxIds,
  getAllInboxIds,
  getInboxById,
  getInboxsByCategory,
  INBOX_STATS,
};

export default inboxConfigExport;
