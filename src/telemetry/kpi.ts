export const kpiTelemetryCategories = [
  "business",
  "product",
  "ai",
  "governance",
  "workflow",
  "reliability"
] as const;

export const kpiTelemetryUnits = [
  "count",
  "percent",
  "ratio",
  "milliseconds",
  "seconds",
  "minutes",
  "score"
] as const;

export const kpiTelemetrySources = [
  "local_summary",
  "quality_summary",
  "governance_summary",
  "workflow_plan",
  "manual_review"
] as const;

export type KpiTelemetryCategory = (typeof kpiTelemetryCategories)[number];
export type KpiTelemetryUnit = (typeof kpiTelemetryUnits)[number];
export type KpiTelemetrySource = (typeof kpiTelemetrySources)[number];
export type KpiTelemetryMetadataValue = string | number | boolean | null;

export interface KpiTelemetryEventInput {
  metricName: string;
  category: string;
  organizationId: string;
  value: number;
  unit: string;
  capturedAt: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface KpiTelemetryEvent {
  id: string;
  metricName: string;
  category: KpiTelemetryCategory;
  organizationId: string;
  value: number;
  unit: KpiTelemetryUnit;
  capturedAt: string;
  source: KpiTelemetrySource;
  metadata: Record<string, KpiTelemetryMetadataValue>;
}

export type KpiTelemetryErrorCode =
  | "invalid_metric"
  | "invalid_category"
  | "invalid_scope"
  | "invalid_value"
  | "invalid_unit"
  | "invalid_timestamp"
  | "invalid_source"
  | "unsafe_metadata";

export class KpiTelemetryValidationError extends Error {
  constructor(
    public readonly code: KpiTelemetryErrorCode,
    message: string
  ) {
    super(message);
    this.name = "KpiTelemetryValidationError";
  }
}

const unsafeMetadataKeyPattern =
  /(secret|token|cookie|password|credential|api[-_]?key|raw|source|document|audit|error|stack|trace|log)/i;

function assertAllowed<T extends readonly string[]>(
  value: string,
  allowed: T,
  code: KpiTelemetryErrorCode,
  label: string
): asserts value is T[number] {
  if (!allowed.includes(value)) {
    throw new KpiTelemetryValidationError(code, `Invalid ${label}.`);
  }
}

function normalizeMetricName(metricName: string): string {
  const trimmed = metricName.trim();

  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new KpiTelemetryValidationError(
      "invalid_metric",
      "Metric name is required and must be under 100 characters."
    );
  }

  return trimmed;
}

function metricKey(metricName: string): string {
  return metricName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeScope(organizationId: string): string {
  const trimmed = organizationId.trim();

  if (trimmed.length === 0) {
    throw new KpiTelemetryValidationError(
      "invalid_scope",
      "Organization scope is required."
    );
  }

  return trimmed;
}

function normalizeValue(value: number): number {
  if (!Number.isFinite(value)) {
    throw new KpiTelemetryValidationError(
      "invalid_value",
      "Metric value must be finite."
    );
  }

  return value;
}

function normalizeTimestamp(capturedAt: string): string {
  const parsed = new Date(capturedAt);
  const time = parsed.getTime();

  if (Number.isNaN(time)) {
    throw new KpiTelemetryValidationError(
      "invalid_timestamp",
      "Captured timestamp must be valid."
    );
  }

  return parsed.toISOString();
}

function normalizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, KpiTelemetryMetadataValue> {
  const normalized: Record<string, KpiTelemetryMetadataValue> = {};

  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (unsafeMetadataKeyPattern.test(key)) {
      throw new KpiTelemetryValidationError(
        "unsafe_metadata",
        "KPI telemetry metadata must not contain raw source, audit, error, log, credential, or token fields."
      );
    }

    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new KpiTelemetryValidationError(
        "unsafe_metadata",
        "KPI telemetry metadata values must be aggregate primitives."
      );
    }

    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new KpiTelemetryValidationError(
        "unsafe_metadata",
        "KPI telemetry metadata numbers must be finite."
      );
    }

    normalized[key] =
      typeof value === "string" && value.length > 200
        ? value.slice(0, 200)
        : value;
  }

  return normalized;
}

export function createKpiTelemetryEvent(
  input: KpiTelemetryEventInput
): KpiTelemetryEvent {
  const metricName = normalizeMetricName(input.metricName);
  const organizationId = normalizeScope(input.organizationId);
  const value = normalizeValue(input.value);
  const capturedAt = normalizeTimestamp(input.capturedAt);
  const metadata = normalizeMetadata(input.metadata);

  assertAllowed(
    input.category,
    kpiTelemetryCategories,
    "invalid_category",
    "category"
  );
  assertAllowed(input.unit, kpiTelemetryUnits, "invalid_unit", "unit");
  assertAllowed(input.source, kpiTelemetrySources, "invalid_source", "source");

  return {
    id: `kpi_${metricKey(metricName)}_${Date.parse(capturedAt)}`,
    metricName,
    category: input.category,
    organizationId,
    value,
    unit: input.unit,
    capturedAt,
    source: input.source,
    metadata
  };
}
