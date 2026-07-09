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
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UserCircle,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AuthSession } from "@/auth/session";
import type { LocalAnswerResponse } from "@/answers/types";
import {
  createBlockedConnectorStatus,
  createConnectorStatusFromIngestion,
  type ConnectorStatus,
  type ConnectorSyncMode
} from "@/connectors/status";
import type { NormalizedIngestionResult } from "@/ingestion/types";
import { createRetrievalQualitySummary } from "@/quality/retrieval";
import { createSourceQualitySummary } from "@/quality/source";
import type { LocalSearchResponse } from "@/search/types";
import { createWorkflowStatusRunRequest } from "@/workflows/default-template";
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

const membershipRoles: MembershipRole[] = ["owner", "admin", "editor", "viewer"];

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
  const [auditEvents, setAuditEvents] = useState<ManagedAuditEvent[]>([]);
  const [permissionViolations, setPermissionViolations] = useState<
    PermissionViolationSignal[]
  >([]);
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
    | "audit-events"
    | "permission-violations"
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

  useEffect(() => {
    void loadCurrentSession({ quiet: true });
  }, []);

  useEffect(() => {
    setAuditEvents([]);
    setPermissionViolations([]);

    if (!session || !isMembershipManager(session.role)) {
      setMemberships([]);
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
