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
