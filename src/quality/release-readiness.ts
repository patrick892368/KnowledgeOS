export type ReleaseReadinessCheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "not_run";

export type ReleaseReadinessStatus = "ready" | "warning" | "blocked";
export type ReleaseRiskSeverity = "low" | "medium" | "high";

export interface ReleaseReadinessCheck {
  label: string;
  status: ReleaseReadinessCheckStatus;
  detail?: string;
}

export interface ReleaseRisk {
  severity: ReleaseRiskSeverity;
  description: string;
}

export interface ReleaseReadinessSummary {
  status: ReleaseReadinessStatus;
  scope: "local_explicit_inputs_only";
  remoteCiStatus: "not_claimed";
  checks: ReleaseReadinessCheck[];
  passedChecks: number;
  warningChecks: number;
  failedChecks: number;
  notRunChecks: number;
  knownRiskCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  blockingReasons: string[];
}

export type ReleaseReadinessTrend =
  | "no_history"
  | "improving"
  | "stable"
  | "regressing"
  | "blocked";

export interface ReleaseReadinessSnapshot {
  capturedAt: string;
  status: ReleaseReadinessStatus;
  scope: "local_explicit_inputs_only";
  remoteCiStatus: "not_claimed";
  passedChecks: number;
  warningChecks: number;
  failedChecks: number;
  notRunChecks: number;
  knownRiskCount: number;
  highRiskCount: number;
}

export interface ReleaseReadinessHistorySummary {
  trend: ReleaseReadinessTrend;
  snapshotCount: number;
  latestStatus: ReleaseReadinessStatus | "none";
  previousStatus: ReleaseReadinessStatus | "none";
  latestCapturedAt: string | null;
  localOnlySnapshotCount: number;
  blockedSnapshotCount: number;
}

function readinessScore(status: ReleaseReadinessStatus): number {
  return status === "ready" ? 3 : status === "warning" ? 2 : 1;
}

function sortSnapshots(
  snapshots: ReleaseReadinessSnapshot[]
): ReleaseReadinessSnapshot[] {
  return [...snapshots].sort(
    (left, right) =>
      new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime()
  );
}

export function createReleaseReadinessSummary(input: {
  checks: ReleaseReadinessCheck[];
  knownRisks?: ReleaseRisk[];
}): ReleaseReadinessSummary {
  const knownRisks = input.knownRisks ?? [];
  const passedChecks = input.checks.filter((check) => check.status === "pass").length;
  const warningChecks = input.checks.filter(
    (check) => check.status === "warning"
  ).length;
  const failedChecks = input.checks.filter((check) => check.status === "fail").length;
  const notRunChecks = input.checks.filter(
    (check) => check.status === "not_run"
  ).length;
  const highRiskCount = knownRisks.filter((risk) => risk.severity === "high").length;
  const mediumRiskCount = knownRisks.filter(
    (risk) => risk.severity === "medium"
  ).length;
  const lowRiskCount = knownRisks.filter((risk) => risk.severity === "low").length;
  const blockingReasons = [
    ...input.checks
      .filter((check) => check.status === "fail")
      .map((check) => `${check.label} failed`),
    ...knownRisks
      .filter((risk) => risk.severity === "high")
      .map((risk) => `High risk: ${risk.description}`)
  ];

  return {
    status:
      failedChecks > 0 || highRiskCount > 0
        ? "blocked"
        : warningChecks > 0 || notRunChecks > 0 || mediumRiskCount > 0
          ? "warning"
          : "ready",
    scope: "local_explicit_inputs_only",
    remoteCiStatus: "not_claimed",
    checks: input.checks,
    passedChecks,
    warningChecks,
    failedChecks,
    notRunChecks,
    knownRiskCount: knownRisks.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    blockingReasons
  };
}

export function createReleaseReadinessSnapshot(input: {
  summary: ReleaseReadinessSummary;
  capturedAt: string;
}): ReleaseReadinessSnapshot {
  return {
    capturedAt: input.capturedAt,
    status: input.summary.status,
    scope: input.summary.scope,
    remoteCiStatus: input.summary.remoteCiStatus,
    passedChecks: input.summary.passedChecks,
    warningChecks: input.summary.warningChecks,
    failedChecks: input.summary.failedChecks,
    notRunChecks: input.summary.notRunChecks,
    knownRiskCount: input.summary.knownRiskCount,
    highRiskCount: input.summary.highRiskCount
  };
}

export function createReleaseReadinessHistorySummary(input: {
  snapshots: ReleaseReadinessSnapshot[];
}): ReleaseReadinessHistorySummary {
  const snapshots = sortSnapshots(input.snapshots);
  const [latest, previous] = snapshots;
  let trend: ReleaseReadinessTrend = "no_history";

  if (latest) {
    if (latest.status === "blocked") {
      trend = "blocked";
    } else if (!previous) {
      trend = "stable";
    } else {
      const latestScore = readinessScore(latest.status);
      const previousScore = readinessScore(previous.status);

      trend =
        latestScore > previousScore
          ? "improving"
          : latestScore < previousScore
            ? "regressing"
            : "stable";
    }
  }

  return {
    trend,
    snapshotCount: snapshots.length,
    latestStatus: latest?.status ?? "none",
    previousStatus: previous?.status ?? "none",
    latestCapturedAt: latest?.capturedAt ?? null,
    localOnlySnapshotCount: snapshots.filter(
      (snapshot) =>
        snapshot.scope === "local_explicit_inputs_only" &&
        snapshot.remoteCiStatus === "not_claimed"
    ).length,
    blockedSnapshotCount: snapshots.filter(
      (snapshot) => snapshot.status === "blocked"
    ).length
  };
}
