export const appMetadata = {
  name: "KnowledgeOS",
  phase: "Foundation",
  tagline: "Permission-aware knowledge and workflow memory for AI-assisted teams"
} as const;

export const foundationChecks = [
  {
    label: "Agent OS",
    status: "Ready",
    detail: "Project rules, PRD, tasks, status, and handoff docs are initialized."
  },
  {
    label: "Application Stack",
    status: "Ready",
    detail: "Next.js, TypeScript, ESLint, and Vitest are configured."
  },
  {
    label: "Product Features",
    status: "Pending",
    detail: "Business features start after the data model and permission foundation."
  }
] as const;

export type FoundationCheck = (typeof foundationChecks)[number];
