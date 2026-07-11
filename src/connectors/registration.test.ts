import { describe, expect, it } from "vitest";

import type { AuthSession } from "@/auth/session";

import {
  ExternalConnectorRegistrationError,
  parseExternalConnectorRegistrationPayload,
  planExternalConnectorRegistration
} from "./registration";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};
const registrationId = "77777777-7777-4777-8777-777777777777";
const credentialReference =
  "cred_88888888-8888-4888-8888-888888888888";
const cursorReference = "cursor_99999999-9999-4999-8999-999999999999";
const now = new Date("2026-07-11T02:00:00.000Z");
const basePayload = {
  connectorType: "github",
  accountReference: "installation:123456",
  credentialReference,
  sourceScope: {
    kind: "repository",
    externalId: "Patrick892368/KnowledgeOS"
  },
  capabilities: [
    "permission_sync",
    "content_read",
    "metadata_read",
    "incremental_sync"
  ],
  permissionMode: "source_acl",
  citationRequired: true,
  configuration: {
    displayName: "KnowledgeOS GitHub",
    syncStrategy: "incremental",
    cursorReference
  }
};

describe("external connector registration", () => {
  it("creates a deterministic credential-safe plan and audit intent", () => {
    const plan = planExternalConnectorRegistration({
      session,
      payload: basePayload,
      registrationId,
      now
    });

    expect(plan).toEqual({
      id: registrationId,
      organizationId: session.organizationId,
      connectorType: "github",
      accountReference: "installation:123456",
      credentialReference,
      sourceScope: {
        kind: "repository",
        externalId: "patrick892368/knowledgeos"
      },
      capabilities: [
        "metadata_read",
        "content_read",
        "incremental_sync",
        "permission_sync"
      ],
      permissionMode: "source_acl",
      citationRequired: true,
      configuration: {
        displayName: "KnowledgeOS GitHub",
        syncStrategy: "incremental",
        cursorReference
      },
      status: "planned",
      executionMode: "plan_only",
      persistence: "not_performed",
      oauth: "not_performed",
      networkAccess: "not_performed",
      ingestion: "not_performed",
      syncExecution: "not_performed",
      credentialExposure: "reference_only",
      sourceContentExposure: "not_exposed",
      createdAt: now,
      auditIntent: {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "connector.registration_planned",
        resourceType: "organization",
        resourceId: session.organizationId,
        metadata: {
          connectorRegistrationId: registrationId,
          connectorType: "github",
          scopeKind: "repository",
          capabilities: [
            "metadata_read",
            "content_read",
            "incremental_sync",
            "permission_sync"
          ],
          permissionMode: "source_acl",
          citationRequired: true,
          executionMode: "plan_only",
          credentialExposure: "reference_only",
          sourceContentExposure: "not_exposed"
        }
      }
    });
    expect(JSON.stringify(plan.auditIntent)).not.toContain(credentialReference);
    expect(JSON.stringify(plan)).not.toMatch(
      /ghp_|xoxb-|ya29\.|secret_|rawContent|sourceContent":/i
    );
  });

  it("normalizes valid Provider-specific source scopes", () => {
    const cases = [
      {
        connectorType: "github",
        accountReference: "installation:123",
        sourceScope: { kind: "repository", externalId: "OpenAI/Codex" },
        expected: "openai/codex"
      },
      {
        connectorType: "slack",
        accountReference: "workspace:t12345678",
        sourceScope: { kind: "channel", externalId: "c12345678" },
        expected: "C12345678"
      },
      {
        connectorType: "google_drive",
        accountReference: "workspace:acme",
        sourceScope: { kind: "folder", externalId: "Folder_123456789" },
        expected: "Folder_123456789"
      },
      {
        connectorType: "notion",
        accountReference: "workspace:acme",
        sourceScope: {
          kind: "page",
          externalId: "11111111-1111-4111-8111-111111111111"
        },
        expected: "11111111111141118111111111111111"
      }
    ];

    for (const testCase of cases) {
      const parsed = parseExternalConnectorRegistrationPayload({
        ...basePayload,
        connectorType: testCase.connectorType,
        accountReference: testCase.accountReference,
        sourceScope: testCase.sourceScope
      });

      expect(parsed.sourceScope.externalId).toBe(testCase.expected);
    }
  });

  it("rejects non-manager sessions before creating a plan", () => {
    for (const role of ["editor", "viewer"] as const) {
      expect(() =>
        planExternalConnectorRegistration({
          session: { ...session, role },
          payload: basePayload,
          registrationId,
          now
        })
      ).toThrowError(expect.objectContaining({ code: "forbidden" }));
    }
  });

  it("hides cross-organization registration targets", () => {
    expect(() =>
      planExternalConnectorRegistration({
        session,
        payload: {
          ...basePayload,
          organizationId: "99999999-9999-4999-8999-999999999999"
        },
        registrationId,
        now
      })
    ).toThrowError(expect.objectContaining({ code: "not_found" }));
  });

  it("rejects raw credential fields at any depth", () => {
    const unsafePayloads = [
      { ...basePayload, apiKey: "ghp_abcdefghijklmnopqrstuvwxyz" },
      { ...basePayload, access_token: "xoxb-1234567890-secret" },
      { ...basePayload, credentials: { value: "private" } },
      {
        ...basePayload,
        sourceScope: {
          ...basePayload.sourceScope,
          password: "private"
        }
      },
      {
        ...basePayload,
        configuration: {
          ...basePayload.configuration,
          clientSecret: "private"
        }
      }
    ];

    for (const payload of unsafePayloads) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrowError(expect.objectContaining({ code: "unsafe_configuration" }));
    }
  });

  it("rejects secret-looking values in otherwise safe display fields", () => {
    for (const displayName of [
      "Bearer abc.def.ghi",
      "ghp_abcdefghijklmnopqrstuvwxyz",
      "xoxb-1234567890-secret",
      "ya29.abcdefghijklmnopqrstuvwxyz",
      "secret_abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN RSA PRIVATE KEY-----"
    ]) {
      expect(() =>
        parseExternalConnectorRegistrationPayload({
          ...basePayload,
          configuration: {
            ...basePayload.configuration,
            displayName
          }
        })
      ).toThrowError(expect.objectContaining({ code: "unsafe_configuration" }));
    }
  });

  it("rejects unknown root, scope, and configuration fields", () => {
    for (const payload of [
      { ...basePayload, persist: true },
      {
        ...basePayload,
        sourceScope: { ...basePayload.sourceScope, workspaceId: "workspace" }
      },
      {
        ...basePayload,
        configuration: { ...basePayload.configuration, schedule: "hourly" }
      }
    ]) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
    }
  });

  it("rejects excessively deep or wide payloads before detailed parsing", () => {
    let deepValue: unknown = "value";

    for (let depth = 0; depth < 10; depth += 1) {
      deepValue = { nested: deepValue };
    }

    for (const payload of [
      { ...basePayload, extra: deepValue },
      {
        ...basePayload,
        extra: Array.from({ length: 33 }, (_, index) => index)
      }
    ]) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
    }
  });

  it("rejects unsupported connector and malformed references", () => {
    const invalidPayloads = [
      { ...basePayload, connectorType: "dropbox" },
      { ...basePayload, accountReference: "unsafe account" },
      { ...basePayload, credentialReference: "ghp_raw_secret_value" },
      { ...basePayload, credentialReference: "cred_not-a-uuid" },
      {
        ...basePayload,
        configuration: {
          ...basePayload.configuration,
          cursorReference: "raw-cursor-value"
        }
      }
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrow(ExternalConnectorRegistrationError);
    }
  });

  it("rejects incompatible or malformed Provider scopes", () => {
    const invalidPayloads = [
      { ...basePayload, sourceScope: { kind: "channel", externalId: "C12345678" } },
      { ...basePayload, sourceScope: { kind: "repository", externalId: "missing-separator" } },
      {
        ...basePayload,
        connectorType: "slack",
        sourceScope: { kind: "channel", externalId: "invalid" }
      },
      {
        ...basePayload,
        connectorType: "google_drive",
        sourceScope: { kind: "folder", externalId: "short" }
      },
      {
        ...basePayload,
        connectorType: "notion",
        sourceScope: { kind: "page", externalId: "not-a-page" }
      },
      {
        ...basePayload,
        connectorType: "notion",
        sourceScope: {
          kind: "page",
          externalId: "1111-11111111-1111-4111-8111-111111111111"
        }
      }
    ];

    for (const payload of invalidPayloads) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrowError(expect.objectContaining({ code: "invalid_scope" }));
    }
  });

  it("rejects duplicate, unsupported, or unsafe capability sets", () => {
    const invalidCapabilities = [
      ["content_read"],
      ["content_read", "content_read", "permission_sync"],
      ["metadata_read", "permission_sync"],
      ["content_read", "incremental_sync"],
      ["content_read", "permission_sync", "delete_source"]
    ];

    for (const capabilities of invalidCapabilities) {
      expect(() =>
        parseExternalConnectorRegistrationPayload({
          ...basePayload,
          capabilities
        })
      ).toThrowError(expect.objectContaining({ code: "invalid_capability" }));
    }
  });

  it("requires source ACL preservation and citations", () => {
    for (const payload of [
      { ...basePayload, permissionMode: "organization_visible" },
      { ...basePayload, citationRequired: false },
      { ...basePayload, citationRequired: undefined }
    ]) {
      expect(() =>
        parseExternalConnectorRegistrationPayload(payload)
      ).toThrowError(expect.objectContaining({ code: "unsafe_configuration" }));
    }
  });

  it("requires incremental capability for incremental configuration", () => {
    expect(() =>
      parseExternalConnectorRegistrationPayload({
        ...basePayload,
        capabilities: ["content_read", "permission_sync"],
        configuration: {
          ...basePayload.configuration,
          cursorReference: undefined
        }
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_capability" }));

    expect(() =>
      parseExternalConnectorRegistrationPayload({
        ...basePayload,
        configuration: {
          ...basePayload.configuration,
          syncStrategy: "full"
        }
      })
    ).toThrowError(expect.objectContaining({ code: "invalid_capability" }));
  });

  it("allows full sync without a cursor reference", () => {
    expect(
      parseExternalConnectorRegistrationPayload({
        ...basePayload,
        capabilities: ["content_read", "permission_sync"],
        configuration: {
          displayName: "KnowledgeOS GitHub",
          syncStrategy: "full"
        }
      })
    ).toMatchObject({
      capabilities: ["content_read", "permission_sync"],
      configuration: { syncStrategy: "full" }
    });
  });

  it("rejects malformed plan identity and time", () => {
    for (const input of [
      { registrationId: "not-a-uuid", now },
      { registrationId, now: new Date("invalid") }
    ]) {
      expect(() =>
        planExternalConnectorRegistration({
          session,
          payload: basePayload,
          ...input
        })
      ).toThrowError(expect.objectContaining({ code: "invalid_payload" }));
    }
  });

  it("freezes the plan boundary and leaves input unchanged", () => {
    const payload = structuredClone(basePayload);
    const snapshot = structuredClone(payload);
    const plan = planExternalConnectorRegistration({
      session,
      payload,
      registrationId,
      now
    });

    expect(payload).toEqual(snapshot);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.sourceScope)).toBe(true);
    expect(Object.isFrozen(plan.capabilities)).toBe(true);
    expect(Object.isFrozen(plan.configuration)).toBe(true);
    expect(Object.isFrozen(plan.auditIntent)).toBe(true);
  });
});
