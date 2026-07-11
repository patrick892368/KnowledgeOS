# KnowledgeOS

KnowledgeOS is an AI-native knowledge management and workflow operating system for trusted search, cited answers, governed source ingestion, and repeatable AI-assisted workflows.

## Current Status

The current application includes:

- Next.js, React, TypeScript, ESLint, and Vitest.
- Protected auth/session foundations.
- Local note, safe URL, and repository metadata ingestion.
- Citation-first local and database search foundations.
- Local grounded answer generation with citation verification.
- Connector status tracking.
- Plan-only workflow template and workflow run planning foundations.
- Audited invitation acceptance, resend, delivery attempts, a disabled-by-default Resend adapter, and a protected dispatch API.

## Development

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 after starting the dev server.

## Invitation Email

Copy the non-secret defaults from `.env.example`. To enable Resend invitation email delivery, set:

```bash
KNOWLEDGEOS_RESEND_ENABLED=true
KNOWLEDGEOS_APP_URL='https://knowledge.example.com/'
RESEND_API_KEY=re_replace_with_a_server_only_key
KNOWLEDGEOS_INVITATION_FROM_EMAIL='KnowledgeOS <invitations@example.com>'
KNOWLEDGEOS_RESEND_TIMEOUT_MS=10000
```

The sender domain must be verified in Resend. Keep `RESEND_API_KEY` server-only and leave the adapter disabled until the configuration is complete.

## Verification

```bash
npm run build
npm run lint
npm run typecheck
npm run test
```
