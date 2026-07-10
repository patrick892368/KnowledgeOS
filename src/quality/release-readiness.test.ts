import { describe, expect, it } from "vitest";

import {
  createReleaseReadinessHistorySummary,
  createReleaseReadinessSnapshot,
  createReleaseReadinessSummary,
  type ReleaseReadinessCheck
} from "./release-readiness";

const passingChecks: ReleaseReadinessCheck[] = [
  { label: "Build", status: "pass" },
  { label: "Lint", status: "pass" },
  { label: "Type Check", status: "pass" },
  { label: "Tests", status: "pass" },
  { label: "Review Gate", status: "pass" },
  { label: "Documentation", status: "pass" }
];

describe("createReleaseReadinessSummary", () => {
  it("marks release readiness as ready when all local gates pass", () => {
    expect(
      createReleaseReadinessSummary({
        checks: passingChecks,
        knownRisks: []
      })
    ).toEqual({
      status: "ready",
      scope: "local_explicit_inputs_only",
      remoteCiStatus: "not_claimed",
      checks: passingChecks,
      passedChecks: 6,
      warningChecks: 0,
      failedChecks: 0,
      notRunChecks: 0,
      knownRiskCount: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      blockingReasons: []
    });
  });

  it("marks release readiness as warning for incomplete checks or medium risks", () => {
    const summary = createReleaseReadinessSummary({
      checks: [
        ...passingChecks.slice(0, 4),
        { label: "Review Gate", status: "warning" },
        { label: "Documentation", status: "not_run" }
      ],
      knownRisks: [
        {
          severity: "medium",
          description: "Live database smoke check has not run."
        }
      ]
    });

    expect(summary).toMatchObject({
      status: "warning",
      warningChecks: 1,
      notRunChecks: 1,
      mediumRiskCount: 1,
      remoteCiStatus: "not_claimed"
    });
    expect(summary.blockingReasons).toEqual([]);
  });

  it("marks release readiness as blocked for failed checks or high risks", () => {
    const summary = createReleaseReadinessSummary({
      checks: [
        ...passingChecks.slice(0, 3),
        { label: "Tests", status: "fail", detail: "Regression failed." },
        ...passingChecks.slice(4)
      ],
      knownRisks: [
        {
          severity: "high",
          description: "Review Gate failed."
        }
      ]
    });

    expect(summary).toMatchObject({
      status: "blocked",
      failedChecks: 1,
      highRiskCount: 1,
      remoteCiStatus: "not_claimed"
    });
    expect(summary.blockingReasons).toEqual([
      "Tests failed",
      "High risk: Review Gate failed."
    ]);
  });
});

describe("createReleaseReadinessHistorySummary", () => {
  it("returns no-history state without snapshots", () => {
    expect(
      createReleaseReadinessHistorySummary({
        snapshots: []
      })
    ).toEqual({
      trend: "no_history",
      snapshotCount: 0,
      latestStatus: "none",
      previousStatus: "none",
      latestCapturedAt: null,
      localOnlySnapshotCount: 0,
      blockedSnapshotCount: 0
    });
  });

  it("detects improving readiness from explicit local snapshots", () => {
    const warning = createReleaseReadinessSnapshot({
      summary: createReleaseReadinessSummary({
        checks: [
          ...passingChecks.slice(0, 5),
          { label: "Documentation", status: "not_run" }
        ]
      }),
      capturedAt: "2026-07-10T00:00:00.000Z"
    });
    const ready = createReleaseReadinessSnapshot({
      summary: createReleaseReadinessSummary({
        checks: passingChecks
      }),
      capturedAt: "2026-07-10T01:00:00.000Z"
    });

    expect(
      createReleaseReadinessHistorySummary({
        snapshots: [warning, ready]
      })
    ).toMatchObject({
      trend: "improving",
      latestStatus: "ready",
      previousStatus: "warning",
      localOnlySnapshotCount: 2,
      blockedSnapshotCount: 0
    });
  });

  it("keeps blocked history explicit when the latest snapshot is blocked", () => {
    const blocked = createReleaseReadinessSnapshot({
      summary: createReleaseReadinessSummary({
        checks: [
          ...passingChecks.slice(0, 4),
          { label: "Review Gate", status: "fail" },
          { label: "Documentation", status: "pass" }
        ]
      }),
      capturedAt: "2026-07-10T02:00:00.000Z"
    });

    expect(
      createReleaseReadinessHistorySummary({
        snapshots: [blocked]
      })
    ).toMatchObject({
      trend: "blocked",
      latestStatus: "blocked",
      blockedSnapshotCount: 1,
      localOnlySnapshotCount: 1
    });
  });
});
