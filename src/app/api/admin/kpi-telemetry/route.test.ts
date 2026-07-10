import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, type AuthSession } from "@/auth/session";
import { KpiTelemetryPersistenceError } from "@/db/kpi-telemetry-repository";
import { KpiTelemetryValidationError } from "@/telemetry/kpi";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  createDatabaseClient: vi.fn(),
  listOrganizationKpiTelemetryEvents: vi.fn(),
  persistKpiTelemetryEvent: vi.fn()
}));

vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();

  return {
    ...actual,
    requireSession: mocks.requireSession
  };
});

vi.mock("@/db/client", () => ({
  createDatabaseClient: mocks.createDatabaseClient
}));

vi.mock("@/db/kpi-telemetry-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/kpi-telemetry-repository")>();

  return {
    ...actual,
    listOrganizationKpiTelemetryEvents: mocks.listOrganizationKpiTelemetryEvents,
    persistKpiTelemetryEvent: mocks.persistKpiTelemetryEvent
  };
});

import { GET, POST } from "./route";

const session: AuthSession = {
  userId: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  membershipId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  email: "owner@knowledgeos.local",
  name: "KnowledgeOS Owner",
  source: "signed-cookie"
};

const eventRequest = {
  metricName: "Admin Analytics Health Score",
  category: "business",
  organizationId: session.organizationId,
  value: 1,
  unit: "score",
  capturedAt: "2026-07-10T02:30:00.000Z",
  source: "local_summary",
  metadata: {
    status: "healthy",
    signalCount: 7,
    localOnly: true
  }
};

const persistedEvent = {
  id: "kpi_admin_analytics_health_score_1783650600000",
  organizationId: session.organizationId,
  metricName: "Admin Analytics Health Score",
  category: "business",
  value: 1,
  unit: "score",
  capturedAt: new Date("2026-07-10T02:30:00.000Z"),
  source: "local_summary",
  metadata: {
    status: "healthy",
    signalCount: 7,
    localOnly: true
  },
  createdAt: new Date("2026-07-10T02:31:00.000Z")
};

function request(body: unknown): Request {
  return new Request("http://knowledgeos.local/api/admin/kpi-telemetry", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

function listRequest(limit?: string): Request {
  return new Request(
    `http://knowledgeos.local/api/admin/kpi-telemetry${
      limit ? `?limit=${limit}` : ""
    }`
  );
}

describe("POST /api/admin/kpi-telemetry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("persists an aggregate-safe KPI telemetry event", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistKpiTelemetryEvent.mockResolvedValue({
      mode: "created",
      event: persistedEvent
    });

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      mode: string;
      event: {
        id: string;
        capturedAt: string;
        createdAt: string;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.mode).toBe("created");
    expect(payload.event).toMatchObject({
      id: persistedEvent.id,
      capturedAt: "2026-07-10T02:30:00.000Z",
      createdAt: "2026-07-10T02:31:00.000Z"
    });
    expect(mocks.persistKpiTelemetryEvent).toHaveBeenCalledWith(db, {
      session,
      event: eventRequest
    });
  });

  it("returns existing mode for duplicate KPI telemetry events", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistKpiTelemetryEvent.mockResolvedValue({
      mode: "existing",
      event: persistedEvent
    });

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      mode: string;
    };

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("existing");
  });

  it("returns unsafe metadata validation errors", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistKpiTelemetryEvent.mockRejectedValue(
      new KpiTelemetryValidationError(
        "unsafe_metadata",
        "KPI telemetry metadata must not contain raw fields."
      )
    );

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("unsafe_metadata");
  });

  it("returns cross-organization persistence failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistKpiTelemetryEvent.mockRejectedValue(
      new KpiTelemetryPersistenceError(
        "cross_scope",
        "KPI telemetry event organization must match the current session."
      )
    );

    const response = await POST(
      request({
        ...eventRequest,
        organizationId: "99999999-9999-4999-8999-999999999999"
      })
    );
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("cross_scope");
  });

  it("returns non-manager authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue({
      ...session,
      role: "viewer"
    });
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.persistKpiTelemetryEvent.mockRejectedValue(
      new KpiTelemetryPersistenceError(
        "forbidden",
        "Only owner or admin members can manage KPI telemetry."
      )
    );

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
  });

  it("returns database unavailable when persistence cannot open the database", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
        recoverable: boolean;
      };
    };

    expect(response.status).toBe(503);
    expect(payload.error).toMatchObject({
      code: "database_unavailable",
      recoverable: true
    });
  });

  it("rejects unauthenticated requests", async () => {
    mocks.requireSession.mockRejectedValue(
      new AuthError(
        "unauthenticated",
        "Authentication is required for this resource."
      )
    );

    const response = await POST(request(eventRequest));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("unauthenticated");
  });
});

describe("GET /api/admin/kpi-telemetry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists bounded current-organization KPI telemetry events", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationKpiTelemetryEvents.mockResolvedValue([persistedEvent]);

    const response = await GET(listRequest("25"));
    const payload = (await response.json()) as {
      events: Array<{
        id: string;
        organizationId: string;
        createdAt: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.events).toEqual([
      expect.objectContaining({
        id: persistedEvent.id,
        organizationId: session.organizationId,
        createdAt: "2026-07-10T02:31:00.000Z"
      })
    ]);
    expect(mocks.listOrganizationKpiTelemetryEvents).toHaveBeenCalledWith(db, {
      session,
      limit: 25
    });
  });

  it("rejects invalid list limits before database access", async () => {
    mocks.requireSession.mockResolvedValue(session);

    const response = await GET(listRequest("many"));
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("invalid_payload");
    expect(mocks.createDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.listOrganizationKpiTelemetryEvents).not.toHaveBeenCalled();
  });

  it("returns list authorization failures", async () => {
    const db = { name: "db" };
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockReturnValue(db);
    mocks.listOrganizationKpiTelemetryEvents.mockRejectedValue(
      new KpiTelemetryPersistenceError(
        "forbidden",
        "Only owner or admin members can manage KPI telemetry."
      )
    );

    const response = await GET(listRequest());
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("forbidden");
  });

  it("returns database unavailable when events cannot be listed", async () => {
    mocks.requireSession.mockResolvedValue(session);
    mocks.createDatabaseClient.mockImplementation(() => {
      throw new Error("DATABASE_URL is required to create a database client.");
    });

    const response = await GET(listRequest());
    const payload = (await response.json()) as {
      error: {
        code: string;
      };
    };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("database_unavailable");
  });
});
