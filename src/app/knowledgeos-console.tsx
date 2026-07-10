"use client";

import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  GitBranch,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCircle,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createAdminAnalyticsHistorySummary,
  createAdminAnalyticsSnapshot,
  createAdminAnalyticsSummary
} from "@/analytics/admin";
import type { AuthSession } from "@/auth/session";
import type { LocalAnswerResponse } from "@/answers/types";
import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion,
  type ConnectorStatus,
  type ConnectorSyncMode
} from "@/connectors/status";
import type { NormalizedIngestionResult } from "@/ingestion/types";
import { createConnectorReliabilitySummary } from "@/quality/connector-reliability";
import { createSourceFreshnessSummary } from "@/quality/freshness";
import { createOperationalReliabilitySummary } from "@/quality/operational-reliability";
import {
  createReleaseReadinessHistorySummary,
  createReleaseReadinessSnapshot,
  createReleaseReadinessSummary
} from "@/quality/release-readiness";
import { createRetrievalQualitySummary } from "@/quality/retrieval";
import { createSourceQualitySummary } from "@/quality/source";
import type { LocalSearchResponse } from "@/search/types";
import { createWorkflowStatusRunRequest } from "@/workflows/default-template";
import { createWorkflowMetricsSummary } from "@/workflows/metrics";
import type { WorkflowRunPlan } from "@/workflows/run";

type ApiError = {
  error: {
    code: string;
    message: string;
    recoverable?: boolean;
  };
};

type SearchMode = "request-scoped" | "persisted";
type MembershipRole = AuthSession["role"];

type IngestionPersistence =
  | {
      mode: "request-scoped";
    }
  | {
      mode: "postgres";
      sourceId: string;
      documentId: string;
      chunkIds: string[];
      embeddingIds: string[];
      citationIds: string[];
      embeddingModel: string;
      duplicateKey: {
        sourceId: string;
        contentHash: string;
      };
    };

type ManagedMembership = {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  createdAt: string;
  updatedAt: string;
};

type ManagedAuditEvent = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type InvitationRole = Exclude<MembershipRole, "owner">;
type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

type ManagedInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string;
  revokedAt?: string;
};

type InvitationResult = ManagedInvitation & {
  mode: "planned" | "created" | "existing";
  auditAction?: string;
};

type PermissionViolationSignal = {
  id: string;
  organizationId: string;
  auditEventId: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  violationType: string;
  severity: "low" | "medium" | "high";
  sourceAction: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

type PermissionGrantSubjectType = "user" | "membership" | "role";
type PermissionGrantResourceType =
  | "organization"
  | "source"
  | "document"
  | "workflow";
type PermissionGrantAction = "read" | "write" | "admin";
type PermissionGrantMode = "planned" | "created" | "existing";

type PermissionGrantPlan = {
  id?: string;
  organizationId: string;
  subjectType: PermissionGrantSubjectType;
  subjectId: string;
  resourceType: PermissionGrantResourceType;
  resourceId: string;
  action: PermissionGrantAction;
  createdAt: string;
};

type PermissionGrantResult = PermissionGrantPlan & {
  mode: PermissionGrantMode;
  auditAction?: string;
};

type ManagedPermissionGrant = PermissionGrantPlan & {
  id: string;
};

const membershipRoles: MembershipRole[] = ["owner", "admin", "editor", "viewer"];
const invitationRoles: InvitationRole[] = ["admin", "editor", "viewer"];
const permissionSubjectTypes: PermissionGrantSubjectType[] = [
  "role",
  "membership",
  "user"
];
const permissionResourceTypes: PermissionGrantResourceType[] = [
  "workflow",
  "document",
  "source",
  "organization"
];
const permissionActions: PermissionGrantAction[] = ["read", "write", "admin"];

function upsertPermissionGrant(
  grants: ManagedPermissionGrant[],
  grant: ManagedPermissionGrant
) {
  const withoutGrant = grants.filter((item) => item.id !== grant.id);

  return [grant, ...withoutGrant].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function upsertInvitation(
  invitations: ManagedInvitation[],
  invitation: ManagedInvitation
) {
  const withoutInvitation = invitations.filter((item) => item.id !== invitation.id);

  return [invitation, ...withoutInvitation].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

const developmentHeaders = {
  "content-type": "application/json",
  "x-knowledgeos-user-id": "22222222-2222-4222-8222-222222222222",
  "x-knowledgeos-organization-id": "11111111-1111-4111-8111-111111111111",
  "x-knowledgeos-membership-id": "33333333-3333-4333-8333-333333333333",
  "x-knowledgeos-role": "editor",
  "x-knowledgeos-user-email": "editor@knowledgeos.local",
  "x-knowledgeos-user-name": "KnowledgeOS Editor"
};

const sampleContent =
  "Retrieval uses permission filters before ranking.\n\nCitations must support generated answers and include source references for every returned result.";

function isApiError(payload: unknown): payload is ApiError {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiError).error.message === "string"
  );
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    throw new Error(isApiError(payload) ? payload.error.message : "Request failed.");
  }

  return payload as T;
}

function formatStatus(value: string) {
  return value.replace(/_/g, " ");
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function isMembershipManager(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

function connectorSyncMode(searchMode: SearchMode): ConnectorSyncMode {
  return searchMode === "persisted" ? "persisted" : "request_scoped";
}

function formatActivityTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatAuditMetadata(metadata: Record<string, unknown>): string {
  if (Object.keys(metadata).length === 0) {
    return "No metadata";
  }

  return JSON.stringify(metadata);
}

export function KnowledgeOSConsole() {
  const [searchMode, setSearchMode] = useState<SearchMode>("request-scoped");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loginEmail, setLoginEmail] = useState("owner@knowledgeos.local");
  const [loginPassword, setLoginPassword] = useState("");
  const [title, setTitle] = useState("RAG Architecture");
  const [content, setContent] = useState(sampleContent);
  const [sourceUrl, setSourceUrl] = useState("https://example.com/");
  const [repositoryUrl, setRepositoryUrl] = useState(
    "https://github.com/patrick892368/KnowledgeOS"
  );
  const [query, setQuery] = useState("permission citations");
  const [ingestions, setIngestions] = useState<NormalizedIngestionResult[]>([]);
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatus[]>(
    []
  );
  const [lastPersistence, setLastPersistence] =
    useState<IngestionPersistence | null>(null);
  const [searchResponse, setSearchResponse] =
    useState<LocalSearchResponse | null>(null);
  const [answerResponse, setAnswerResponse] =
    useState<LocalAnswerResponse | null>(null);
  const [workflowTaskId, setWorkflowTaskId] = useState("T-028");
  const [workflowRunPlan, setWorkflowRunPlan] =
    useState<WorkflowRunPlan | null>(null);
  const [memberships, setMemberships] = useState<ManagedMembership[]>([]);
  const [invitationEmail, setInvitationEmail] = useState(
    "new.member@example.com"
  );
  const [invitationRole, setInvitationRole] = useState<InvitationRole>("viewer");
  const [invitationExpiresInDays, setInvitationExpiresInDays] = useState(7);
  const [invitationResult, setInvitationResult] =
    useState<InvitationResult | null>(null);
  const [invitations, setInvitations] = useState<ManagedInvitation[]>([]);
  const [pendingRevokeInvitationId, setPendingRevokeInvitationId] =
    useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<ManagedAuditEvent[]>([]);
  const [permissionViolations, setPermissionViolations] = useState<
    PermissionViolationSignal[]
  >([]);
  const [grantSubjectType, setGrantSubjectType] =
    useState<PermissionGrantSubjectType>("role");
  const [grantSubjectId, setGrantSubjectId] = useState("editor");
  const [grantResourceType, setGrantResourceType] =
    useState<PermissionGrantResourceType>("workflow");
  const [grantResourceId, setGrantResourceId] = useState("workflow_1");
  const [grantAction, setGrantAction] = useState<PermissionGrantAction>("read");
  const [permissionGrantPlan, setPermissionGrantPlan] =
    useState<PermissionGrantResult | null>(null);
  const [permissionGrants, setPermissionGrants] = useState<
    ManagedPermissionGrant[]
  >([]);
  const [pendingRevokeGrantId, setPendingRevokeGrantId] = useState<string | null>(
    null
  );
  const [memberRoleEdits, setMemberRoleEdits] = useState<
    Record<string, MembershipRole>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    | "ingest"
    | "url-ingest"
    | "repository-ingest"
    | "search"
    | "answer"
    | "login"
    | "members"
    | "member-role"
    | "invitation"
    | "invitations"
    | "invitation-revoke"
    | "audit-events"
    | "permission-violations"
    | "permission-grant"
    | "permission-grants"
    | "permission-grant-revoke"
    | "workflow"
    | null
  >(null);

  const metrics = useMemo(() => {
    const chunks = ingestions.reduce(
      (total, ingestion) => total + ingestion.chunks.length,
      0
    );

    return {
      sources: ingestions.length,
      chunks,
      results: searchResponse?.results.length ?? 0,
      citationCoverage: searchResponse?.metrics.citationCoverage ?? 0
    };
  }, [ingestions, searchResponse]);

  const retrievalQuality = useMemo(
    () =>
      createRetrievalQualitySummary({
        search: searchResponse,
        answer: answerResponse
      }),
    [answerResponse, searchResponse]
  );
  const sourceQuality = useMemo(
    () =>
      createSourceQualitySummary({
        ingestions,
        connectorStatuses
      }),
    [connectorStatuses, ingestions]
  );
  const sourceFreshness = useMemo(
    () =>
      createSourceFreshnessSummary({
        ingestions,
        connectorStatuses
      }),
    [connectorStatuses, ingestions]
  );
  const connectorReliability = useMemo(
    () =>
      createConnectorReliabilitySummary({
        connectorStatuses
      }),
    [connectorStatuses]
  );
  const workflowMetrics = useMemo(
    () =>
      createWorkflowMetricsSummary({
        plans: workflowRunPlan ? [workflowRunPlan] : []
      }),
    [workflowRunPlan]
  );
  const releaseReadiness = useMemo(
    () =>
      createReleaseReadinessSummary({
        checks: [
          { label: "Build", status: "pass" },
          { label: "Lint", status: "pass" },
          { label: "Type Check", status: "pass" },
          { label: "Tests", status: "pass" },
          { label: "Review Gate", status: "pass" },
          { label: "Documentation", status: "pass" }
        ],
        knownRisks: [
          {
            severity: "medium",
            description: "Live database smoke check has not run."
          }
        ]
      }),
    []
  );
  const releaseReadinessHistory = useMemo(() => {
    const previous = createReleaseReadinessSnapshot({
      summary: createReleaseReadinessSummary({
        checks: [
          { label: "Build", status: "pass" },
          { label: "Lint", status: "pass" },
          { label: "Type Check", status: "pass" },
          { label: "Tests", status: "fail" },
          { label: "Review Gate", status: "warning" },
          { label: "Documentation", status: "not_run" }
        ],
        knownRisks: [
          {
            severity: "high",
            description: "Review Gate had not passed."
          }
        ]
      }),
      capturedAt: "2026-07-10T00:00:00.000Z"
    });
    const latest = createReleaseReadinessSnapshot({
      summary: releaseReadiness,
      capturedAt: "2026-07-10T01:00:00.000Z"
    });

    return createReleaseReadinessHistorySummary({
      snapshots: [previous, latest]
    });
  }, [releaseReadiness]);
  const operationalReliability = useMemo(
    () =>
      createOperationalReliabilitySummary({
        sourceQuality: sourceQuality.status,
        sourceFreshness: sourceFreshness.status,
        connectorReliability: connectorReliability.status,
        workflowMetrics: workflowMetrics.status,
        releaseReadiness: releaseReadiness.status
      }),
    [
      connectorReliability.status,
      releaseReadiness.status,
      sourceFreshness.status,
      sourceQuality.status,
      workflowMetrics.status
    ]
  );
  const adminAnalytics = useMemo(
    () =>
      createAdminAnalyticsSummary({
        retrievalQuality: retrievalQuality.status,
        sourceQuality: sourceQuality.status,
        sourceFreshness: sourceFreshness.status,
        connectorReliability: connectorReliability.status,
        workflowMetrics: workflowMetrics.status,
        operationalReliability: operationalReliability.status,
        governance: {
          auditEventCount: auditEvents.length,
          permissionViolationCount: permissionViolations.length,
          highSeverityViolationCount: permissionViolations.filter(
            (violation) => violation.severity === "high"
          ).length
        }
      }),
    [
      auditEvents.length,
      connectorReliability.status,
      operationalReliability.status,
      permissionViolations,
      retrievalQuality.status,
      sourceFreshness.status,
      sourceQuality.status,
      workflowMetrics.status
    ]
  );
  const adminAnalyticsHistory = useMemo(() => {
    const previous = createAdminAnalyticsSnapshot({
      summary: createAdminAnalyticsSummary({
        retrievalQuality: "insufficient_context",
        sourceQuality: "needs_attention",
        sourceFreshness: "stale",
        connectorReliability: "degraded",
        workflowMetrics: "review_heavy",
        operationalReliability: "warning",
        governance: {
          auditEventCount: 1,
          permissionViolationCount: 1,
          highSeverityViolationCount: 0
        }
      }),
      capturedAt: "2026-07-10T00:30:00.000Z"
    });
    const latest = createAdminAnalyticsSnapshot({
      summary: adminAnalytics,
      capturedAt: "2026-07-10T01:30:00.000Z"
    });

    return createAdminAnalyticsHistorySummary({
      snapshots: [previous, latest]
    });
  }, [adminAnalytics]);

  useEffect(() => {
    void loadCurrentSession({ quiet: true });
  }, []);

  useEffect(() => {
    setAuditEvents([]);
    setPermissionViolations([]);

    if (!session || !isMembershipManager(session.role)) {
      setMemberships([]);
      setInvitations([]);
      setPendingRevokeInvitationId(null);
      setMemberRoleEdits({});
      return;
    }

    void loadMemberships({ quiet: true });
  }, [session?.organizationId, session?.role]);

  async function loadCurrentSession(options: { quiet: boolean }) {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin"
      });

      if (response.status === 401) {
        setSession(null);
        return;
      }

      const payload = await readApiResponse<{
        session: AuthSession;
      }>(response);

      setSession(payload.session);
    } catch (caughtError) {
      setSession(null);

      if (!options.quiet) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Session check failed."
        );
      }
    }
  }

  async function login() {
    setBusyAction("login");
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword
        })
      });
      const payload = await readApiResponse<{
        session: AuthSession;
      }>(response);

      setSession(payload.session);
      setLoginPassword("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Login failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function logout() {
    setBusyAction("login");
    setError(null);

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });
      setSession(null);
      setMemberships([]);
      setMemberRoleEdits({});
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Logout failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function loadMemberships(options: { quiet: boolean }) {
    if (!session || !isMembershipManager(session.role)) {
      if (!options.quiet) {
        setError("Owner or admin signed session is required.");
      }

      return;
    }

    setBusyAction("members");
    setError(null);

    try {
      const response = await fetch("/api/admin/memberships", {
        credentials: "same-origin"
      });
      const payload = await readApiResponse<{
        memberships: ManagedMembership[];
      }>(response);

      setMemberships(payload.memberships);
      setMemberRoleEdits(
        Object.fromEntries(
          payload.memberships.map((membership) => [
            membership.id,
            membership.role
          ])
        )
      );
    } catch (caughtError) {
      if (!options.quiet) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Memberships failed to load."
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function loadAuditEvents(options: { quiet: boolean }) {
    if (!canManageCurrentMemberships) {
      setAuditEvents([]);

      if (!options.quiet) {
        setError("Owner or admin signed session is required.");
      }

      return;
    }

    setBusyAction("audit-events");
    setError(null);

    try {
      const response = await fetch("/api/admin/audit-events", {
        credentials: "same-origin"
      });
      const payload = await readApiResponse<{
        auditEvents: ManagedAuditEvent[];
      }>(response);

      setAuditEvents(payload.auditEvents);
    } catch (caughtError) {
      if (!options.quiet) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Audit events failed to load."
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function loadPermissionViolations(options: { quiet: boolean }) {
    if (!canManageCurrentMemberships) {
      setPermissionViolations([]);

      if (!options.quiet) {
        setError("Owner or admin signed session is required.");
      }

      return;
    }

    setBusyAction("permission-violations");
    setError(null);

    try {
      const response = await fetch("/api/admin/permission-violations", {
        credentials: "same-origin"
      });
      const payload = await readApiResponse<{
        permissionViolations: PermissionViolationSignal[];
      }>(response);

      setPermissionViolations(payload.permissionViolations);
    } catch (caughtError) {
      if (!options.quiet) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Permission violations failed to load."
        );
      }
    } finally {
      setBusyAction(null);
    }
  }

  function updateMemberRoleDraft(
    membershipId: string,
    role: MembershipRole
  ): void {
    setMemberRoleEdits((current) => ({
      ...current,
      [membershipId]: role
    }));
  }

  async function updateMemberRole(membershipId: string) {
    const role = memberRoleEdits[membershipId];

    if (!role) {
      return;
    }

    setBusyAction("member-role");
    setError(null);

    try {
      const response = await fetch("/api/admin/memberships", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          membershipId,
          role
        })
      });
      const payload = await readApiResponse<{
        membership: ManagedMembership;
      }>(response);

      setMemberships((current) =>
        current.map((membership) =>
          membership.id === payload.membership.id ? payload.membership : membership
        )
      );
      setMemberRoleEdits((current) => ({
        ...current,
        [payload.membership.id]: payload.membership.role
      }));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Membership role update failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function submitInvitation(persist: boolean) {
    if (!canManageCurrentMemberships) {
      setInvitationResult(null);
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("invitation");
    setError(null);

    try {
      const response = await fetch("/api/admin/invitations", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: invitationEmail,
          role: invitationRole,
          expiresInDays: invitationExpiresInDays,
          ...(persist ? { persist: true } : {})
        })
      });
      const payload = await readApiResponse<{
        mode?: InvitationResult["mode"];
        invitation: Omit<InvitationResult, "mode" | "auditAction">;
        auditEvent?: {
          action: string;
        };
      }>(response);

      setInvitationResult({
        ...payload.invitation,
        mode: payload.mode ?? "planned",
        auditAction: payload.auditEvent?.action
      });
      if (persist) {
        setInvitations((current) => upsertInvitation(current, payload.invitation));
      }
    } catch (caughtError) {
      setInvitationResult(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : persist
            ? "Invitation persistence failed."
            : "Invitation planning failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function planInvitation() {
    void submitInvitation(false);
  }

  function persistInvitationFromUi() {
    void submitInvitation(true);
  }

  async function loadInvitations() {
    if (!canManageCurrentMemberships) {
      setInvitations([]);
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("invitations");
    setPendingRevokeInvitationId(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/invitations", {
        method: "GET",
        credentials: "same-origin"
      });
      const payload = await readApiResponse<{
        invitations: ManagedInvitation[];
      }>(response);

      setInvitations(payload.invitations);
    } catch (caughtError) {
      setInvitations([]);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Invitation loading failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!canManageCurrentMemberships) {
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("invitation-revoke");
    setError(null);

    try {
      const payload = await readApiResponse<{
        invitation: ManagedInvitation;
      }>(
        await fetch("/api/admin/invitations", {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            invitationId
          })
        })
      );

      setInvitations((current) => upsertInvitation(current, payload.invitation));
      setInvitationResult((current) =>
        current?.id === payload.invitation.id
          ? {
              ...current,
              ...payload.invitation
            }
          : current
      );
      setPendingRevokeInvitationId(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Invitation revocation failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function requestInvitationRevoke(invitationId: string) {
    if (pendingRevokeInvitationId !== invitationId) {
      setPendingRevokeInvitationId(invitationId);
      return;
    }

    void revokeInvitation(invitationId);
  }

  async function submitPermissionGrant(persist: boolean) {
    if (!canManageCurrentMemberships) {
      setPermissionGrantPlan(null);
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("permission-grant");
    setError(null);

    try {
      const response = await fetch("/api/admin/permission-grants", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          subjectType: grantSubjectType,
          subjectId: grantSubjectId,
          resourceType: grantResourceType,
          resourceId: grantResourceId,
          action: grantAction,
          ...(persist ? { persist: true } : {})
        })
      });
      const payload = await readApiResponse<{
        mode?: PermissionGrantMode;
        grant: PermissionGrantPlan;
        auditEvent?: {
          action: string;
        };
      }>(response);

      setPermissionGrantPlan({
        ...payload.grant,
        mode: payload.mode ?? "planned",
        auditAction: payload.auditEvent?.action
      });
      if (persist && payload.grant.id) {
        const grantId = payload.grant.id;

        setPermissionGrants((current) =>
          upsertPermissionGrant(current, {
            ...payload.grant,
            id: grantId
          })
        );
      }
    } catch (caughtError) {
      setPermissionGrantPlan(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : persist
            ? "Permission grant persistence failed."
            : "Permission grant planning failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function planPermissionGrant() {
    void submitPermissionGrant(false);
  }

  function persistPermissionGrant() {
    void submitPermissionGrant(true);
  }

  async function loadPermissionGrants() {
    if (!canManageCurrentMemberships) {
      setPermissionGrants([]);
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("permission-grants");
    setPendingRevokeGrantId(null);
    setError(null);

    try {
      const response = await fetch("/api/admin/permission-grants", {
        method: "GET",
        credentials: "same-origin"
      });
      const payload = await readApiResponse<{
        grants: ManagedPermissionGrant[];
      }>(response);

      setPermissionGrants(payload.grants);
    } catch (caughtError) {
      setPermissionGrants([]);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Permission grant loading failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function revokePermissionGrant(grantId: string) {
    if (!canManageCurrentMemberships) {
      setError("Owner or admin signed session is required.");
      return;
    }

    setBusyAction("permission-grant-revoke");
    setError(null);

    try {
      await readApiResponse<{
        grant: ManagedPermissionGrant;
      }>(
        await fetch("/api/admin/permission-grants", {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            grantId
          })
        })
      );

      setPermissionGrants((current) =>
        current.filter((grant) => grant.id !== grantId)
      );
      if (permissionGrantPlan?.id === grantId) {
        setPermissionGrantPlan(null);
      }
      setPendingRevokeGrantId(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Permission grant revocation failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function requestPermissionGrantRevoke(grantId: string) {
    if (pendingRevokeGrantId !== grantId) {
      setPendingRevokeGrantId(grantId);
      return;
    }

    void revokePermissionGrant(grantId);
  }

  function selectSearchMode(nextMode: SearchMode) {
    setSearchMode(nextMode);
    setLastPersistence(null);
    setSearchResponse(null);
    setAnswerResponse(null);
    setError(null);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setSearchResponse(null);
    setAnswerResponse(null);
  }

  function recordConnectorStatus(status: ConnectorStatus) {
    setConnectorStatuses((current) => [status, ...current].slice(0, 8));
  }

  async function ingestNote() {
    setBusyAction("ingest");
    setError(null);

    try {
      const response = await fetch("/api/ingest/local-note", {
        method: "POST",
        credentials: "same-origin",
        headers: developmentHeaders,
        body: JSON.stringify({
          title,
          content,
          uri: `local://${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          persist: searchMode === "persisted"
        })
      });
      const payload = await readApiResponse<{
        ingestion: NormalizedIngestionResult;
        persistence: IngestionPersistence;
      }>(response);

      setIngestions((current) => [payload.ingestion, ...current]);
      recordConnectorStatus(
        createConnectorStatusFromIngestion(
          payload.ingestion,
          payload.persistence
        )
      );
      setLastPersistence(payload.persistence);
      setSearchResponse(null);
      setAnswerResponse(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "Ingestion failed.";

      recordConnectorStatus(
        createBlockedConnectorStatus({
          sourceType: "note",
          sourceName: title || "Local note",
          sourceUri: `local://${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          syncMode: connectorSyncMode(searchMode),
          errorMessage: message
        })
      );
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function ingestUrlSource() {
    setBusyAction("url-ingest");
    setError(null);

    try {
      const response = await fetch("/api/ingest/url", {
        method: "POST",
        credentials: "same-origin",
        headers: developmentHeaders,
        body: JSON.stringify({
          url: sourceUrl,
          persist: searchMode === "persisted",
          metadata: {
            connector: "manual-url"
          }
        })
      });
      const payload = await readApiResponse<{
        ingestion: NormalizedIngestionResult;
        persistence: IngestionPersistence;
      }>(response);

      setIngestions((current) => [payload.ingestion, ...current]);
      recordConnectorStatus(
        createConnectorStatusFromIngestion(
          payload.ingestion,
          payload.persistence
        )
      );
      setLastPersistence(payload.persistence);
      setSearchResponse(null);
      setAnswerResponse(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : "URL ingestion failed.";

      recordConnectorStatus(
        createBlockedConnectorStatus({
          sourceType: "url",
          sourceName: "URL",
          sourceUri: sourceUrl,
          syncMode: connectorSyncMode(searchMode),
          errorMessage: message
        })
      );
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function ingestRepositorySource() {
    setBusyAction("repository-ingest");
    setError(null);

    try {
      const response = await fetch("/api/ingest/repository", {
        method: "POST",
        credentials: "same-origin",
        headers: developmentHeaders,
        body: JSON.stringify({
          repositoryUrl,
          persist: searchMode === "persisted",
          metadata: {
            connector: "manual-repository"
          }
        })
      });
      const payload = await readApiResponse<{
        ingestion: NormalizedIngestionResult;
        persistence: IngestionPersistence;
      }>(response);

      setIngestions((current) => [payload.ingestion, ...current]);
      recordConnectorStatus(
        createConnectorStatusFromIngestion(
          payload.ingestion,
          payload.persistence
        )
      );
      setLastPersistence(payload.persistence);
      setSearchResponse(null);
      setAnswerResponse(null);
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Repository ingestion failed.";

      recordConnectorStatus(
        createBlockedConnectorStatus({
          sourceType: "repository",
          sourceName: "Repository",
          sourceUri: repositoryUrl,
          syncMode: connectorSyncMode(searchMode),
          errorMessage: message
        })
      );
      setError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function runSearch() {
    setBusyAction("search");
    setError(null);

    try {
      const endpoint =
        searchMode === "persisted" ? "/api/search/database" : "/api/search/local";
      const requestBody =
        searchMode === "persisted"
          ? {
              query
            }
          : {
              query,
              corpus: ingestions
            };
      const response = await fetch(
        endpoint,
        {
          method: "POST",
          credentials: "same-origin",
          headers: developmentHeaders,
          body: JSON.stringify(requestBody)
        }
      );
      const payload = await readApiResponse<{
        search: LocalSearchResponse;
      }>(response);

      setSearchResponse(payload.search);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Search failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function runAnswer() {
    setBusyAction("answer");
    setError(null);

    try {
      const response = await fetch("/api/answers/local", {
        method: "POST",
        credentials: "same-origin",
        headers: developmentHeaders,
        body: JSON.stringify({
          query,
          corpus: ingestions
        })
      });
      const payload = await readApiResponse<{
        answer: LocalAnswerResponse;
      }>(response);

      setAnswerResponse(payload.answer);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : "Answer failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function planWorkflowRun() {
    setBusyAction("workflow");
    setError(null);

    try {
      const response = await fetch("/api/workflows/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: developmentHeaders,
        body: JSON.stringify(
          createWorkflowStatusRunRequest(workflowTaskId.trim())
        )
      });
      const payload = await readApiResponse<{
        run: WorkflowRunPlan;
      }>(response);

      setWorkflowRunPlan(payload.run);
    } catch (caughtError) {
      setWorkflowRunPlan(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Workflow planning failed."
      );
    } finally {
      setBusyAction(null);
    }
  }

  function resetWorkspace() {
    setIngestions([]);
    setConnectorStatuses([]);
    setLastPersistence(null);
    setSearchResponse(null);
    setAnswerResponse(null);
    setWorkflowRunPlan(null);
    setPermissionGrantPlan(null);
    setPermissionGrants([]);
    setPendingRevokeGrantId(null);
    setInvitationResult(null);
    setError(null);
  }

  const canManageCurrentMemberships =
    session !== null && isMembershipManager(session.role);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <span className="brand-mark">KO</span>
          <div>
            <span className="brand-title">KnowledgeOS</span>
            <span className="brand-subtitle">Local workspace</span>
          </div>
        </div>
        <nav>
          <ul className="nav-list">
            <li className="nav-item active">
              <Search size={16} />
              Search
            </li>
            <li className="nav-item">
              <FileText size={16} />
              Sources
            </li>
            <li className="nav-item">
              <Users size={16} />
              Members
            </li>
            <li className="nav-item">
              <ClipboardList size={16} />
              Tasks
            </li>
            <li className="nav-item">
              <Activity size={16} />
              Metrics
            </li>
          </ul>
        </nav>
      </aside>

      <div className="content">
        <header className="topbar">
          <div>
            <span className="eyebrow">Foundation console</span>
            <h1>Knowledge operations</h1>
          </div>
          <div className="topbar-actions">
            <div
              className="segmented-control"
              role="group"
              aria-label="Search mode"
            >
              <button
                className={searchMode === "request-scoped" ? "active" : ""}
                type="button"
                onClick={() => selectSearchMode("request-scoped")}
              >
                <FileText size={14} />
                Request
              </button>
              <button
                className={searchMode === "persisted" ? "active" : ""}
                type="button"
                onClick={() => selectSearchMode("persisted")}
              >
                <Database size={14} />
                Persisted
              </button>
            </div>
            <span className="status-pill">
              <ShieldCheck size={14} />
              {session ? `${session.role} signed session` : "Development headers"}
            </span>
            <button className="icon-button" type="button" onClick={resetWorkspace}>
              <RefreshCw size={16} />
              <span>Reset</span>
            </button>
          </div>
        </header>

        <main className="main-panel">
          {error ? <div className="alert">{error}</div> : null}

          <section className="identity-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Identity</span>
                <h2>Session</h2>
              </div>
              <span className="count-pill">
                {session ? "Signed cookie" : "Bootstrap"}
              </span>
            </div>

            <div className="identity-grid">
              <label className="field">
                <span>Email</span>
                <input
                  autoComplete="username"
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                />
              </label>
              <div className="identity-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={login}
                  disabled={busyAction !== null || loginPassword.length === 0}
                >
                  <LogIn size={16} />
                  {busyAction === "login" ? "Signing in" : "Sign in"}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => loadCurrentSession({ quiet: false })}
                  disabled={busyAction !== null}
                >
                  <UserCircle size={16} />
                  <span>Session</span>
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={logout}
                  disabled={busyAction !== null || session === null}
                >
                  <LogOut size={16} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>

            <div className="identity-note">
              <UserCircle size={16} />
              <span>
                {session
                  ? `${session.email ?? session.userId} | ${session.organizationId}`
                  : "No signed session"}
              </span>
            </div>
          </section>

          <section className="invitation-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Onboarding</span>
                <h2>Invitations</h2>
              </div>
              <span className="count-pill">
                {invitationResult ? formatStatus(invitationResult.mode) : "Plan only"}
              </span>
            </div>

            <div className="invitation-toolbar">
              <span className="status-pill">
                <ShieldCheck size={14} />
                {canManageCurrentMemberships
                  ? "Owner/admin invites"
                  : "Manager session required"}
              </span>
              <span className="status-pill">
                <Mail size={14} />
                Token-safe persistence
              </span>
              <button
                className="icon-button"
                type="button"
                onClick={loadInvitations}
                disabled={busyAction !== null || !canManageCurrentMemberships}
              >
                <RefreshCw size={15} />
                {busyAction === "invitations" ? "Refreshing" : "Refresh"}
              </button>
            </div>

            <div className="invitation-form">
              <label className="field">
                <span>Email</span>
                <input
                  value={invitationEmail}
                  onChange={(event) => setInvitationEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Role</span>
                <select
                  value={invitationRole}
                  onChange={(event) =>
                    setInvitationRole(event.target.value as InvitationRole)
                  }
                >
                  {invitationRoles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Expires</span>
                <input
                  max={30}
                  min={1}
                  type="number"
                  value={invitationExpiresInDays}
                  onChange={(event) =>
                    setInvitationExpiresInDays(Number(event.target.value))
                  }
                />
              </label>
              <div className="invitation-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={planInvitation}
                  disabled={
                    busyAction !== null ||
                    !canManageCurrentMemberships ||
                    invitationEmail.trim().length === 0
                  }
                >
                  <ShieldCheck size={16} />
                  {busyAction === "invitation" ? "Reviewing" : "Review"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={persistInvitationFromUi}
                  disabled={
                    busyAction !== null ||
                    !canManageCurrentMemberships ||
                    invitationEmail.trim().length === 0
                  }
                >
                  <Database size={16} />
                  {busyAction === "invitation" ? "Saving" : "Persist"}
                </button>
              </div>
            </div>

            {invitationResult ? (
              <div className="invitation-output">
                <div>
                  <span>Mode</span>
                  <strong>{formatStatus(invitationResult.mode)}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{invitationResult.email}</strong>
                </div>
                <div>
                  <span>Role</span>
                  <strong>{invitationResult.role}</strong>
                </div>
                <div>
                  <span>Expires</span>
                  <strong>{formatActivityTime(invitationResult.expiresAt)}</strong>
                </div>
                {invitationResult.auditAction ? (
                  <div>
                    <span>Audit</span>
                    <strong>{formatStatus(invitationResult.auditAction)}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">No invitation planned</div>
            )}

            <div className="invitation-list">
              <div className="invitation-list-header">
                <span>Durable invitations</span>
                <span className="count-pill">{invitations.length} invites</span>
              </div>
              {invitations.map((invitation) => (
                <article className="invitation-row" key={invitation.id}>
                  <div className="invitation-row-main">
                    <span>{invitation.email}</span>
                    <strong>
                      {invitation.role} | {formatStatus(invitation.status)}
                    </strong>
                  </div>
                  <div className="invitation-row-meta">
                    <span>Expires {formatActivityTime(invitation.expiresAt)}</span>
                    {invitation.revokedAt ? (
                      <small>
                        Revoked {formatActivityTime(invitation.revokedAt)}
                      </small>
                    ) : (
                      <small>Created {formatActivityTime(invitation.createdAt)}</small>
                    )}
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => requestInvitationRevoke(invitation.id)}
                    disabled={
                      busyAction !== null ||
                      !canManageCurrentMemberships ||
                      invitation.status !== "pending"
                    }
                  >
                    <Trash2 size={15} />
                    {invitation.status !== "pending"
                      ? formatStatus(invitation.status)
                      : pendingRevokeInvitationId === invitation.id
                        ? "Confirm"
                        : "Revoke"}
                  </button>
                </article>
              ))}
              {invitations.length === 0 ? (
                <div className="empty-state">No durable invitations loaded</div>
              ) : null}
            </div>
          </section>

          <section className="membership-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Admin</span>
                <h2>Memberships</h2>
              </div>
              <span className="count-pill">{memberships.length} members</span>
            </div>

            <div className="membership-toolbar">
              <button
                className="icon-button"
                type="button"
                onClick={() => loadMemberships({ quiet: false })}
                disabled={busyAction !== null || !canManageCurrentMemberships}
              >
                <Users size={16} />
                <span>{busyAction === "members" ? "Loading" : "Refresh"}</span>
              </button>
              <span className="status-pill">
                <ShieldCheck size={14} />
                {canManageCurrentMemberships
                  ? "Owner/admin controls"
                  : "Manager session required"}
              </span>
            </div>

            <div className="membership-list">
              {memberships.map((membership) => {
                const draftRole =
                  memberRoleEdits[membership.id] ?? membership.role;

                return (
                  <article className="membership-row" key={membership.id}>
                    <div className="membership-person">
                      <UserCircle size={18} />
                      <div>
                        <span>{membership.name}</span>
                        <small>
                          {membership.email} | {membership.id}
                        </small>
                      </div>
                    </div>
                    <label className="role-select">
                      <span>Role</span>
                      <select
                        value={draftRole}
                        onChange={(event) =>
                          updateMemberRoleDraft(
                            membership.id,
                            event.target.value as MembershipRole
                          )
                        }
                        disabled={!canManageCurrentMemberships}
                      >
                        {membershipRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => updateMemberRole(membership.id)}
                      disabled={
                        busyAction !== null ||
                        !canManageCurrentMemberships ||
                        draftRole === membership.role
                      }
                    >
                      {busyAction === "member-role" ? "Saving" : "Update"}
                    </button>
                  </article>
                );
              })}
              {memberships.length === 0 ? (
                <div className="empty-state">
                  Sign in as owner/admin and refresh memberships
                </div>
              ) : null}
            </div>
          </section>

          <section className="audit-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Governance</span>
                <h2>Audit events</h2>
              </div>
              <span className="count-pill">{auditEvents.length} events</span>
            </div>

            <div className="audit-toolbar">
              <button
                className="icon-button"
                type="button"
                onClick={() => loadAuditEvents({ quiet: false })}
                disabled={busyAction !== null || !canManageCurrentMemberships}
              >
                <ShieldCheck size={16} />
                <span>
                  {busyAction === "audit-events" ? "Loading" : "Refresh"}
                </span>
              </button>
              <span className="status-pill">
                <ShieldCheck size={14} />
                {canManageCurrentMemberships
                  ? "Owner/admin audit"
                  : "Manager session required"}
              </span>
            </div>

            <div className="audit-list">
              {auditEvents.map((event) => (
                <article className="audit-row" key={event.id}>
                  <div className="audit-row-main">
                    <Activity size={16} />
                    <div>
                      <span>{event.action}</span>
                      <small>
                        {formatStatus(event.resourceType)} | {event.resourceId}
                      </small>
                    </div>
                  </div>
                  <div className="audit-row-meta">
                    <span>
                      {event.actorEmail ?? event.actorUserId ?? "System actor"}
                    </span>
                    <small>{formatActivityTime(event.createdAt)}</small>
                  </div>
                  <code>{formatAuditMetadata(event.metadata)}</code>
                </article>
              ))}
              {auditEvents.length === 0 ? (
                <div className="empty-state">
                  Sign in as owner/admin and refresh audit events
                </div>
              ) : null}
            </div>
          </section>

          <section className="violation-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Risk</span>
                <h2>Permission violations</h2>
              </div>
              <span className="count-pill">
                {permissionViolations.length} signals
              </span>
            </div>

            <div className="violation-toolbar">
              <button
                className="icon-button"
                type="button"
                onClick={() => loadPermissionViolations({ quiet: false })}
                disabled={busyAction !== null || !canManageCurrentMemberships}
              >
                <ShieldCheck size={16} />
                <span>
                  {busyAction === "permission-violations"
                    ? "Loading"
                    : "Refresh"}
                </span>
              </button>
              <span className="status-pill">
                <ShieldCheck size={14} />
                {canManageCurrentMemberships
                  ? "Owner/admin risk"
                  : "Manager session required"}
              </span>
            </div>

            <div className="violation-list">
              {permissionViolations.map((violation) => (
                <article
                  className={`violation-row severity-${violation.severity}`}
                  key={violation.id}
                >
                  <div className="violation-row-main">
                    <ShieldCheck size={16} />
                    <div>
                      <span>{formatStatus(violation.violationType)}</span>
                      <small>
                        {formatStatus(violation.resourceType)} |{" "}
                        {violation.resourceId}
                      </small>
                    </div>
                  </div>
                  <div className="violation-row-meta">
                    <strong>{violation.severity}</strong>
                    <span>
                      {violation.actorEmail ??
                        violation.actorUserId ??
                        "System actor"}
                    </span>
                    <small>{formatActivityTime(violation.occurredAt)}</small>
                  </div>
                  <code>{formatAuditMetadata(violation.metadata)}</code>
                </article>
              ))}
              {permissionViolations.length === 0 ? (
                <div className="empty-state">No permission violations loaded</div>
              ) : null}
            </div>
          </section>

          <section className="permission-grant-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Access</span>
                <h2>Permission grants</h2>
              </div>
              <span className="count-pill">
                {permissionGrantPlan
                  ? formatStatus(permissionGrantPlan.mode)
                  : "Plan only"}
              </span>
            </div>

            <div className="permission-grant-toolbar">
              <span className="status-pill">
                <ShieldCheck size={14} />
                {canManageCurrentMemberships
                  ? "Owner/admin grants"
                  : "Manager session required"}
              </span>
              <span className="status-pill">
                <Database size={14} />
                Durable write available
              </span>
              <button
                className="icon-button"
                type="button"
                onClick={loadPermissionGrants}
                disabled={busyAction !== null || !canManageCurrentMemberships}
              >
                <RefreshCw size={15} />
                {busyAction === "permission-grants" ? "Refreshing" : "Refresh"}
              </button>
            </div>

            <div className="permission-grant-form">
              <label className="field">
                <span>Subject type</span>
                <select
                  value={grantSubjectType}
                  onChange={(event) =>
                    setGrantSubjectType(
                      event.target.value as PermissionGrantSubjectType
                    )
                  }
                >
                  {permissionSubjectTypes.map((subjectType) => (
                    <option key={subjectType} value={subjectType}>
                      {formatStatus(subjectType)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Subject ID</span>
                <input
                  value={grantSubjectId}
                  onChange={(event) => setGrantSubjectId(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Resource type</span>
                <select
                  value={grantResourceType}
                  onChange={(event) =>
                    setGrantResourceType(
                      event.target.value as PermissionGrantResourceType
                    )
                  }
                >
                  {permissionResourceTypes.map((resourceType) => (
                    <option key={resourceType} value={resourceType}>
                      {formatStatus(resourceType)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Resource ID</span>
                <input
                  value={grantResourceId}
                  onChange={(event) => setGrantResourceId(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Action</span>
                <select
                  value={grantAction}
                  onChange={(event) =>
                    setGrantAction(event.target.value as PermissionGrantAction)
                  }
                >
                  {permissionActions.map((action) => (
                    <option key={action} value={action}>
                      {formatStatus(action)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="permission-grant-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={planPermissionGrant}
                  disabled={
                    busyAction !== null ||
                    !canManageCurrentMemberships ||
                    grantSubjectId.trim().length === 0 ||
                    grantResourceId.trim().length === 0
                  }
                >
                  <ShieldCheck size={16} />
                  {busyAction === "permission-grant" ? "Reviewing" : "Review"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={persistPermissionGrant}
                  disabled={
                    busyAction !== null ||
                    !canManageCurrentMemberships ||
                    grantSubjectId.trim().length === 0 ||
                    grantResourceId.trim().length === 0
                  }
                >
                  <Database size={16} />
                  {busyAction === "permission-grant" ? "Saving" : "Persist"}
                </button>
              </div>
            </div>

            {permissionGrantPlan ? (
              <div className="permission-grant-output">
                <div>
                  <span>Mode</span>
                  <strong>{formatStatus(permissionGrantPlan.mode)}</strong>
                </div>
                {permissionGrantPlan.id ? (
                  <div>
                    <span>Grant ID</span>
                    <strong>{permissionGrantPlan.id}</strong>
                  </div>
                ) : null}
                <div>
                  <span>Subject</span>
                  <strong>
                    {formatStatus(permissionGrantPlan.subjectType)} |{" "}
                    {permissionGrantPlan.subjectId}
                  </strong>
                </div>
                <div>
                  <span>Resource</span>
                  <strong>
                    {formatStatus(permissionGrantPlan.resourceType)} |{" "}
                    {permissionGrantPlan.resourceId}
                  </strong>
                </div>
                <div>
                  <span>Action</span>
                  <strong>{formatStatus(permissionGrantPlan.action)}</strong>
                </div>
                <div>
                  <span>Planned</span>
                  <strong>{formatActivityTime(permissionGrantPlan.createdAt)}</strong>
                </div>
                {permissionGrantPlan.auditAction ? (
                  <div>
                    <span>Audit</span>
                    <strong>{formatStatus(permissionGrantPlan.auditAction)}</strong>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="empty-state">No permission grant planned</div>
            )}

            <div className="permission-grant-list">
              <div className="permission-grant-list-header">
                <span>Durable grants</span>
                <span className="count-pill">{permissionGrants.length} grants</span>
              </div>
              {permissionGrants.map((grant) => (
                <article className="permission-grant-row" key={grant.id}>
                  <div className="permission-grant-row-main">
                    <span>
                      {formatStatus(grant.subjectType)} | {grant.subjectId}
                    </span>
                    <strong>
                      {formatStatus(grant.resourceType)} | {grant.resourceId}
                    </strong>
                  </div>
                  <div className="permission-grant-row-meta">
                    <span>{formatStatus(grant.action)}</span>
                    <small>{formatActivityTime(grant.createdAt)}</small>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => requestPermissionGrantRevoke(grant.id)}
                    disabled={
                      busyAction !== null || !canManageCurrentMemberships
                    }
                  >
                    <Trash2 size={15} />
                    {pendingRevokeGrantId === grant.id ? "Confirm" : "Revoke"}
                  </button>
                </article>
              ))}
              {permissionGrants.length === 0 ? (
                <div className="empty-state">No durable permission grants loaded</div>
              ) : null}
            </div>
          </section>

          <section className="workspace-grid">
            <div className="tool-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Ingestion</span>
                  <h2>Local note</h2>
                </div>
                <span className="count-pill">
                  {searchMode === "persisted"
                    ? "Postgres"
                    : `${metrics.sources} sources`}
                </span>
              </div>

              <label className="field">
                <span>Title</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Content</span>
                <textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  rows={8}
                />
              </label>

              <button
                className="primary-button"
                type="button"
                onClick={ingestNote}
                disabled={busyAction !== null}
              >
                <Upload size={16} />
                {busyAction === "ingest" ? "Ingesting" : "Ingest"}
              </button>

              <div className="url-ingestion">
                <label className="field">
                  <span>URL</span>
                  <input
                    type="url"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={ingestUrlSource}
                  disabled={busyAction !== null || sourceUrl.trim().length === 0}
                >
                  <LinkIcon size={16} />
                  <span>
                    {busyAction === "url-ingest" ? "Fetching" : "Ingest URL"}
                  </span>
                </button>
              </div>

              <div className="repository-ingestion">
                <label className="field">
                  <span>Repository</span>
                  <input
                    type="url"
                    value={repositoryUrl}
                    onChange={(event) => setRepositoryUrl(event.target.value)}
                  />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={ingestRepositorySource}
                  disabled={
                    busyAction !== null || repositoryUrl.trim().length === 0
                  }
                >
                  <GitBranch size={16} />
                  <span>
                    {busyAction === "repository-ingest"
                      ? "Indexing"
                      : "Ingest repo"}
                  </span>
                </button>
              </div>

              {lastPersistence ? (
                <div className="persistence-note">
                  {lastPersistence.mode === "postgres"
                    ? `${lastPersistence.chunkIds.length} chunks | ${
                        lastPersistence.embeddingIds.length
                      } vectors | ${lastPersistence.embeddingModel}`
                    : "Request-scoped only"}
                </div>
              ) : null}
            </div>

            <div className="tool-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Retrieval</span>
                  <h2>Cited search</h2>
                </div>
                <span className="count-pill">{metrics.results} results</span>
              </div>

              <label className="field">
                <span>Query</span>
                <input
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                />
              </label>

              <button
                className="primary-button"
                type="button"
                onClick={runSearch}
                disabled={
                  busyAction !== null ||
                  (searchMode === "request-scoped" && ingestions.length === 0)
                }
              >
                <Search size={16} />
                {busyAction === "search" ? "Searching" : "Search"}
              </button>

              <div className="results-list">
                {searchResponse?.results.map((result) => (
                  <article className="result-card" key={result.citation.label}>
                    <div className="result-topline">
                      <span>{result.source.documentTitle}</span>
                      <span>Score {result.score}</span>
                    </div>
                    <p>{result.snippet}</p>
                    <div className="citation-row">
                      <CheckCircle2 size={14} />
                      <span>{result.citation.label}</span>
                    </div>
                  </article>
                ))}
                {searchResponse && searchResponse.results.length === 0 ? (
                  <div className="empty-state">No cited matches</div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="answer-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Answer</span>
                <h2>Grounded response</h2>
              </div>
              <span
                className={`verification-badge ${
                  answerResponse
                    ? `status-${answerResponse.verification.status}`
                    : ""
                }`}
              >
                {answerResponse
                  ? formatStatus(answerResponse.verification.status)
                  : "Not generated"}
              </span>
            </div>

            <div className="answer-toolbar">
              <button
                className="primary-button"
                type="button"
                onClick={runAnswer}
                disabled={busyAction !== null || ingestions.length === 0}
              >
                <MessageSquare size={16} />
                {busyAction === "answer" ? "Answering" : "Answer"}
              </button>
              <div className="answer-stats">
                <span>{answerResponse?.confidence ?? "no confidence"}</span>
                <span>
                  {answerResponse
                    ? `${Math.round(
                        answerResponse.quality.supportRate * 100
                      )}% supported`
                    : "0% supported"}
                </span>
                <span>
                  {answerResponse
                    ? `${Math.round(
                        answerResponse.quality.unsupportedRate * 100
                      )}% unsupported`
                    : "0% unsupported"}
                </span>
                <span>
                  {answerResponse
                    ? `${Math.round(
                        answerResponse.quality.citationCoverage * 100
                      )}% coverage`
                    : "0% coverage"}
                </span>
                <span>
                  {answerResponse
                    ? `${answerResponse.quality.evidenceCount} evidence`
                    : "0 evidence"}
                </span>
                <span>
                  {answerResponse
                    ? `${answerResponse.citations.length} citations`
                    : "0 citations"}
                </span>
              </div>
            </div>

            {answerResponse ? (
              <div className="answer-output">
                <p>{answerResponse.answer}</p>
                <div className="answer-evidence-list">
                  {answerResponse.evidence.map((item) => (
                    <article
                      className="answer-evidence-row"
                      key={`${item.citation.label}-${item.supportStatus}`}
                    >
                      <div className="result-topline">
                        <span>{item.citation.label}</span>
                        <span>{formatStatus(item.supportStatus)}</span>
                      </div>
                      <p>{item.snippet}</p>
                      <small>{item.reason}</small>
                    </article>
                  ))}
                  {answerResponse.evidence.length === 0 ? (
                    <div className="empty-state">
                      Insufficient authorized context
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="empty-state">No answer generated</div>
            )}
          </section>

          <section className="retrieval-quality-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Quality</span>
                <h2>Retrieval quality</h2>
              </div>
              <span className={`verification-badge status-${retrievalQuality.status}`}>
                {formatStatus(retrievalQuality.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Search coverage</span>
                <strong>{formatPercent(retrievalQuality.searchCitationCoverage)}</strong>
              </div>
              <div className="quality-metric">
                <span>Answer support</span>
                <strong>{formatPercent(retrievalQuality.answerSupportRate)}</strong>
              </div>
              <div className="quality-metric">
                <span>Unsupported</span>
                <strong>
                  {formatPercent(retrievalQuality.answerUnsupportedRate)}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Evidence</span>
                <strong>{retrievalQuality.evidenceCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Results</span>
                <strong>{retrievalQuality.returnedResults}</strong>
              </div>
              <div className="quality-metric">
                <span>Chunks</span>
                <strong>{retrievalQuality.searchedChunks}</strong>
              </div>
            </div>

            {retrievalQuality.hasSearchData || retrievalQuality.hasAnswerData ? (
              <div className="quality-footnote">
                <span>
                  {retrievalQuality.searchedDocuments} documents checked
                </span>
                <span>
                  {formatPercent(retrievalQuality.answerCitationCoverage)} answer coverage
                </span>
              </div>
            ) : (
              <div className="empty-state">No retrieval quality signals</div>
            )}
          </section>

          <section className="source-quality-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Sources</span>
                <h2>Source quality</h2>
              </div>
              <span className={`verification-badge status-${sourceQuality.status}`}>
                {formatStatus(sourceQuality.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Sources</span>
                <strong>{sourceQuality.sourceCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Chunks</span>
                <strong>{sourceQuality.chunkCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Citation coverage</span>
                <strong>{formatPercent(sourceQuality.citationCoverage)}</strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{sourceQuality.blockedConnectorCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Block rate</span>
                <strong>{formatPercent(sourceQuality.connectorBlockRate)}</strong>
              </div>
              <div className="quality-metric">
                <span>Persisted</span>
                <strong>{sourceQuality.persistedConnectorCount}</strong>
              </div>
            </div>

            {sourceQuality.sourceCount > 0 ||
            sourceQuality.connectorEventCount > 0 ? (
              <div className="quality-footnote">
                <span>{sourceQuality.citationCount} citations</span>
                <span>
                  {sourceQuality.requestScopedConnectorCount} request scoped
                </span>
                <span>{sourceQuality.connectorEventCount} connector events</span>
              </div>
            ) : (
              <div className="empty-state">No source quality signals</div>
            )}
          </section>

          <section className="source-freshness-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Sources</span>
                <h2>Source freshness</h2>
              </div>
              <span className={`verification-badge status-${sourceFreshness.status}`}>
                {formatStatus(sourceFreshness.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Latest</span>
                <strong>
                  {sourceFreshness.latestActivityAt
                    ? formatActivityTime(sourceFreshness.latestActivityAt)
                    : "None"}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Tracked</span>
                <strong>{sourceFreshness.trackedSourceCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Fresh</span>
                <strong>{sourceFreshness.freshSourceCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Stale</span>
                <strong>{sourceFreshness.staleSourceCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Stale rate</span>
                <strong>{formatPercent(sourceFreshness.staleRate)}</strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{sourceFreshness.blockedConnectorCount}</strong>
              </div>
            </div>

            {sourceFreshness.sourceCount > 0 ||
            sourceFreshness.connectorEventCount > 0 ? (
              <div className="quality-footnote">
                <span>{sourceFreshness.staleThresholdDays} day threshold</span>
                <span>{sourceFreshness.unknownSourceCount} unknown timestamps</span>
                <span>{sourceFreshness.connectorEventCount} connector events</span>
              </div>
            ) : (
              <div className="empty-state">No source freshness signals</div>
            )}
          </section>

          <section className="connector-reliability-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Connectors</span>
                <h2>Reliability trend</h2>
              </div>
              <span
                className={`verification-badge status-${connectorReliability.status}`}
              >
                {formatStatus(connectorReliability.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Reliability</span>
                <strong>
                  {formatPercent(connectorReliability.reliabilityRate)}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Successful</span>
                <strong>{connectorReliability.successfulConnectorCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{connectorReliability.blockedConnectorCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Block rate</span>
                <strong>{formatPercent(connectorReliability.blockRate)}</strong>
              </div>
              <div className="quality-metric">
                <span>Persisted</span>
                <strong>{connectorReliability.persistedConnectorCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Latest</span>
                <strong>
                  {connectorReliability.latestActivityAt
                    ? formatActivityTime(connectorReliability.latestActivityAt)
                    : "None"}
                </strong>
              </div>
            </div>

            {connectorReliability.connectorEventCount > 0 ? (
              <div className="quality-footnote">
                <span>{connectorReliability.connectorEventCount} events</span>
                <span>
                  {connectorReliability.requestScopedConnectorCount} request scoped
                </span>
                <span>
                  {formatPercent(connectorReliability.persistedRate)} persisted
                </span>
              </div>
            ) : (
              <div className="empty-state">No connector reliability signals</div>
            )}
          </section>

          <section className="workflow-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Workflow</span>
                <h2>Run status</h2>
              </div>
              <span className="count-pill">
                {workflowRunPlan ? formatStatus(workflowRunPlan.status) : "Not planned"}
              </span>
            </div>

            <div className="workflow-toolbar">
              <label className="field">
                <span>Task ID</span>
                <input
                  value={workflowTaskId}
                  onChange={(event) => setWorkflowTaskId(event.target.value)}
                />
              </label>
              <button
                className="primary-button"
                type="button"
                onClick={planWorkflowRun}
                disabled={busyAction !== null}
              >
                <ClipboardList size={16} />
                {busyAction === "workflow" ? "Planning" : "Plan run"}
              </button>
            </div>

            <div className="workflow-status-strip">
              <span className="status-pill">
                <Activity size={14} />
                {workflowRunPlan
                  ? formatStatus(workflowRunPlan.executionMode)
                  : "plan only"}
              </span>
              <span className="status-pill">
                <ShieldCheck size={14} />
                No worker execution
              </span>
              <span className="status-pill">
                <CheckCircle2 size={14} />
                {workflowRunPlan
                  ? `${workflowRunPlan.reviewGates.length} gates`
                  : "0 gates"}
              </span>
            </div>

            {workflowRunPlan ? (
              <div className="workflow-run-grid">
                <div className="workflow-summary">
                  <div>
                    <span>Template</span>
                    <strong>
                      {workflowRunPlan.templateName} v
                      {workflowRunPlan.templateVersion}
                    </strong>
                  </div>
                  <div>
                    <span>Created</span>
                    <strong>{formatActivityTime(workflowRunPlan.createdAt)}</strong>
                  </div>
                  <div>
                    <span>Outputs</span>
                    <strong>{workflowRunPlan.outputKeys.length}</strong>
                  </div>
                  <div>
                    <span>Run ID</span>
                    <strong>{workflowRunPlan.id}</strong>
                  </div>
                </div>

                <div className="workflow-gate-list" aria-label="Review gates">
                  {workflowRunPlan.reviewGates.map((gate) => (
                    <span className="workflow-gate" key={gate}>
                      {formatStatus(gate)}
                    </span>
                  ))}
                </div>

                <div className="workflow-step-list">
                  {workflowRunPlan.steps.map((step, index) => (
                    <article className="workflow-step-row" key={step.id}>
                      <div className="workflow-step-index">{index + 1}</div>
                      <div className="workflow-step-main">
                        <span>{step.name}</span>
                        <small>{step.description}</small>
                        <div className="workflow-step-meta">
                          <span>{step.inputKeys.length} inputs</span>
                          <span>{step.outputKeys.length} outputs</span>
                          <span>{step.reviewGates.length} gates</span>
                        </div>
                      </div>
                      <span className="workflow-step-status">
                        {formatStatus(step.status)}
                      </span>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state">No workflow run planned</div>
            )}
          </section>

          <section className="workflow-metrics-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Automation</span>
                <h2>Workflow metrics</h2>
              </div>
              <span className={`verification-badge status-${workflowMetrics.status}`}>
                {formatStatus(workflowMetrics.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Plans</span>
                <strong>{workflowMetrics.planCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Queued steps</span>
                <strong>{workflowMetrics.queuedStepCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Review gates</span>
                <strong>{workflowMetrics.reviewGateCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Outputs</span>
                <strong>{workflowMetrics.outputKeyCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Plan-only</span>
                <strong>
                  {formatPercent(workflowMetrics.planOnlyComplianceRate)}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Avg gates</span>
                <strong>
                  {workflowMetrics.averageReviewGatesPerPlan.toFixed(1)}
                </strong>
              </div>
            </div>

            {workflowMetrics.planCount > 0 ? (
              <div className="quality-footnote">
                <span>{workflowMetrics.queuedRunCount} queued runs</span>
                <span>{workflowMetrics.uniqueReviewGateCount} unique gates</span>
                <span>No worker execution</span>
              </div>
            ) : (
              <div className="empty-state">No workflow metrics yet</div>
            )}
          </section>

          <section className="release-readiness-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Release</span>
                <h2>Readiness</h2>
              </div>
              <span className={`verification-badge status-${releaseReadiness.status}`}>
                {formatStatus(releaseReadiness.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Passed</span>
                <strong>{releaseReadiness.passedChecks}</strong>
              </div>
              <div className="quality-metric">
                <span>Warnings</span>
                <strong>{releaseReadiness.warningChecks}</strong>
              </div>
              <div className="quality-metric">
                <span>Failed</span>
                <strong>{releaseReadiness.failedChecks}</strong>
              </div>
              <div className="quality-metric">
                <span>Not run</span>
                <strong>{releaseReadiness.notRunChecks}</strong>
              </div>
              <div className="quality-metric">
                <span>Known risks</span>
                <strong>{releaseReadiness.knownRiskCount}</strong>
              </div>
              <div className="quality-metric">
                <span>High risk</span>
                <strong>{releaseReadiness.highRiskCount}</strong>
              </div>
            </div>

            <div className="release-readiness-strip">
              <span className="status-pill">
                <ShieldCheck size={14} />
                Local gates only
              </span>
              <span className="status-pill">
                <Database size={14} />
                Remote CI not claimed
              </span>
            </div>

            <div className="release-check-list">
              {releaseReadiness.checks.map((check) => (
                <article
                  className={`release-check-row status-${check.status}`}
                  key={check.label}
                >
                  <span>{check.label}</span>
                  <strong>{formatStatus(check.status)}</strong>
                  {check.detail ? <small>{check.detail}</small> : null}
                </article>
              ))}
              <article className="release-check-row status-warning">
                <span>Known risk</span>
                <strong>warning</strong>
                <small>Live database smoke check has not run.</small>
              </article>
            </div>
          </section>

          <section className="release-history-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Release</span>
                <h2>Readiness history</h2>
              </div>
              <span
                className={`verification-badge status-${releaseReadinessHistory.trend}`}
              >
                {formatStatus(releaseReadinessHistory.trend)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Snapshots</span>
                <strong>{releaseReadinessHistory.snapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Latest</span>
                <strong>{formatStatus(releaseReadinessHistory.latestStatus)}</strong>
              </div>
              <div className="quality-metric">
                <span>Previous</span>
                <strong>
                  {formatStatus(releaseReadinessHistory.previousStatus)}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{releaseReadinessHistory.blockedSnapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Local-only</span>
                <strong>{releaseReadinessHistory.localOnlySnapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Latest at</span>
                <strong>
                  {releaseReadinessHistory.latestCapturedAt
                    ? formatActivityTime(releaseReadinessHistory.latestCapturedAt)
                    : "None"}
                </strong>
              </div>
            </div>

            <div className="quality-footnote">
              <span>Explicit snapshots only</span>
              <span>Remote CI history not claimed</span>
            </div>
          </section>

          <section className="operational-reliability-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Reliability</span>
                <h2>Operational reliability</h2>
              </div>
              <span
                className={`verification-badge status-${operationalReliability.status}`}
              >
                {formatStatus(operationalReliability.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Signals</span>
                <strong>{operationalReliability.signalCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Healthy</span>
                <strong>{operationalReliability.healthySignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Warnings</span>
                <strong>{operationalReliability.warningSignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{operationalReliability.blockedSignals}</strong>
              </div>
              <div className="quality-metric">
                <span>No data</span>
                <strong>{operationalReliability.noDataSignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Scope</span>
                <strong>Aggregate</strong>
              </div>
            </div>

            <div className="release-readiness-strip">
              <span className="status-pill">
                <ShieldCheck size={14} />
                Aggregate safe summaries
              </span>
              <span className="status-pill">
                <Database size={14} />
                No raw source content
              </span>
            </div>

            <div className="release-check-list">
              {operationalReliability.signals.map((signal) => (
                <article
                  className={`release-check-row status-${signal.status}`}
                  key={signal.label}
                >
                  <span>{signal.label}</span>
                  <strong>{formatStatus(signal.status)}</strong>
                  <small>{formatStatus(signal.sourceStatus)}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-analytics-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Analytics</span>
                <h2>Admin analytics</h2>
              </div>
              <span className={`verification-badge status-${adminAnalytics.status}`}>
                {formatStatus(adminAnalytics.status)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Signals</span>
                <strong>{adminAnalytics.signalCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Healthy</span>
                <strong>{adminAnalytics.healthySignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Warnings</span>
                <strong>{adminAnalytics.warningSignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{adminAnalytics.blockedSignals}</strong>
              </div>
              <div className="quality-metric">
                <span>Violations</span>
                <strong>{adminAnalytics.permissionViolationCount}</strong>
              </div>
              <div className="quality-metric">
                <span>High risk</span>
                <strong>{adminAnalytics.highSeverityViolationCount}</strong>
              </div>
            </div>

            <div className="release-readiness-strip">
              <span className="status-pill">
                <ShieldCheck size={14} />
                Aggregate KPI signals
              </span>
              <span className="status-pill">
                <Database size={14} />
                No raw audit metadata
              </span>
              <span className="status-pill">
                <Activity size={14} />
                {adminAnalytics.governanceEventCount} governance events
              </span>
            </div>

            <div className="release-check-list">
              {adminAnalytics.signals.map((signal) => (
                <article
                  className={`release-check-row status-${signal.status}`}
                  key={signal.label}
                >
                  <span>{signal.label}</span>
                  <strong>{formatStatus(signal.status)}</strong>
                  <small>
                    {formatStatus(signal.category)} |{" "}
                    {formatStatus(signal.sourceStatus)}
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-analytics-history-panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Analytics</span>
                <h2>Analytics history</h2>
              </div>
              <span
                className={`verification-badge status-${adminAnalyticsHistory.trend}`}
              >
                {formatStatus(adminAnalyticsHistory.trend)}
              </span>
            </div>

            <div className="quality-metric-grid">
              <div className="quality-metric">
                <span>Snapshots</span>
                <strong>{adminAnalyticsHistory.snapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Latest</span>
                <strong>{formatStatus(adminAnalyticsHistory.latestStatus)}</strong>
              </div>
              <div className="quality-metric">
                <span>Previous</span>
                <strong>
                  {formatStatus(adminAnalyticsHistory.previousStatus)}
                </strong>
              </div>
              <div className="quality-metric">
                <span>Blocked</span>
                <strong>{adminAnalyticsHistory.blockedSnapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Local-only</span>
                <strong>{adminAnalyticsHistory.localOnlySnapshotCount}</strong>
              </div>
              <div className="quality-metric">
                <span>Latest at</span>
                <strong>
                  {adminAnalyticsHistory.latestCapturedAt
                    ? formatActivityTime(adminAnalyticsHistory.latestCapturedAt)
                    : "None"}
                </strong>
              </div>
            </div>

            <div className="quality-footnote">
              <span>Explicit snapshots only</span>
              <span>Remote telemetry not claimed</span>
            </div>
          </section>

          <section className="lower-grid">
            <div className="data-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Sources</span>
                  <h2>Normalized corpus</h2>
                </div>
              </div>
              <div className="source-list">
                {ingestions.map((ingestion) => (
                  <article
                    className="source-row"
                    key={ingestion.document.contentHash}
                  >
                    <Database size={16} />
                    <div>
                      <span>{ingestion.document.title}</span>
                      <small>
                        {ingestion.chunks.length} chunks |{" "}
                        {ingestion.citations.length} citations
                      </small>
                    </div>
                  </article>
                ))}
                {ingestions.length === 0 ? (
                  <div className="empty-state">No sources indexed</div>
                ) : null}
              </div>
            </div>

            <div className="data-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Connectors</span>
                  <h2>Sync status</h2>
                </div>
                <span className="count-pill">
                  {connectorStatuses.length} events
                </span>
              </div>
              <div className="connector-list">
                {connectorStatuses.map((status) => (
                  <article
                    className={`connector-row status-${status.outcome}`}
                    key={status.id}
                  >
                    <div>
                      <span>{status.sourceName}</span>
                      <small>
                        {formatStatus(status.sourceType)} |{" "}
                        {formatStatus(status.syncMode)} |{" "}
                        {formatActivityTime(status.lastActivityAt)}
                      </small>
                    </div>
                    <strong>{formatStatus(status.outcome)}</strong>
                    <small>{status.safeError ?? status.message}</small>
                  </article>
                ))}
                {connectorStatuses.length === 0 ? (
                  <div className="empty-state">No connector activity</div>
                ) : null}
              </div>
            </div>

            <div className="data-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Project</span>
                  <h2>Task status</h2>
                </div>
              </div>
              <div className="task-list">
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-022 membership management</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-023 URL ingestion</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-024 repository metadata</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-025 connector sync status</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-026 workflow template schema</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-027 workflow run API</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-028 workflow status UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-029 audit event viewer</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-030 permission violation dashboard</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-031 retrieval quality dashboard</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-032 source quality indicators</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-033 source freshness tracking</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-034 connector reliability trend</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-035 invitation lifecycle planning</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-036 permission grant planning</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-037 permission grant UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-038 permission grant persistence</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-039 permission grant persistence UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-040 permission grant revoke API</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-041 permission grant revoke UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-042 invitation persistence</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-043 invitation persistence UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-044 invitation revoke API</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-045 invitation revoke UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-046 workflow metrics foundation</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-047 workflow metrics UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-048 release readiness summary</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-049 release readiness UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-050 release readiness history</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-051 release readiness history UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-052 operational reliability summary</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-053 operational reliability UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-054 admin analytics summary</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-055 admin analytics UI</span>
                </div>
                <div className="task-row done">
                  <CheckCircle2 size={16} />
                  <span>T-056 admin analytics history</span>
                </div>
                <div className="task-row active">
                  <Activity size={16} />
                  <span>T-057 admin analytics history UI</span>
                </div>
              </div>
            </div>

            <div className="data-panel">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Metrics</span>
                  <h2>Quality</h2>
                </div>
              </div>
              <div className="metric-grid">
                <div className="metric">
                  <span>Sources</span>
                  <strong>{metrics.sources}</strong>
                </div>
                <div className="metric">
                  <span>Chunks</span>
                  <strong>{metrics.chunks}</strong>
                </div>
                <div className="metric">
                  <span>Results</span>
                  <strong>{metrics.results}</strong>
                </div>
                <div className="metric">
                  <span>Citations</span>
                  <strong>{Math.round(metrics.citationCoverage * 100)}%</strong>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
