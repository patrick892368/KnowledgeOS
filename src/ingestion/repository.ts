import { IngestionError } from "./errors";
import { chunkText, estimateTokenCount } from "./chunk-text";
import { hashContent } from "./local-note";
import type { NormalizedIngestionResult } from "./types";
import {
  resolveSafeUrl,
  type FetchUrlContentOptions,
  type HostAddressResolver
} from "./url";

export interface RepositoryIngestionInput {
  organizationId: string;
  createdBy: string;
  repositoryUrl?: string;
  host?: string;
  owner?: string;
  name?: string;
  description?: string;
  defaultBranch?: string;
  visibility?: "public" | "private" | "internal" | "unknown";
  topics?: string[];
  metadata?: Record<string, unknown>;
}

export interface RepositoryDescriptor {
  host: string;
  owner: string;
  name: string;
  canonicalUrl: string;
  description?: string;
  defaultBranch?: string;
  visibility: "public" | "private" | "internal" | "unknown";
  topics: string[];
  resolvedAt: Date;
}

type RepositoryLocationOptions = Pick<
  FetchUrlContentOptions,
  "resolveHostAddresses" | "now"
>;

const defaultRepositoryHost = "github.com";
const repositoryIdentityPattern = /^[A-Za-z0-9_.-]{1,100}$/;
const branchPattern = /^[A-Za-z0-9._/-]{1,200}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function optionalMetadata(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function parseTopics(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const topics = value
    .map((topic) => optionalString(topic))
    .filter((topic): topic is string => Boolean(topic))
    .map((topic) => topic.toLowerCase());

  return [...new Set(topics)].slice(0, 20);
}

function parseVisibility(
  value: unknown
): RepositoryIngestionInput["visibility"] {
  if (
    value === "public" ||
    value === "private" ||
    value === "internal" ||
    value === "unknown"
  ) {
    return value;
  }

  return undefined;
}

function validateRepositoryIdentity(value: string, label: string): string {
  const normalized = value.trim();

  if (!repositoryIdentityPattern.test(normalized)) {
    throw new IngestionError(
      "invalid_repository",
      `Repository ${label} must use letters, numbers, dots, underscores, or hyphens.`
    );
  }

  return normalized;
}

function validateBranchName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();

  if (!branchPattern.test(normalized)) {
    throw new IngestionError(
      "invalid_repository",
      "Default branch contains unsupported characters."
    );
  }

  return normalized;
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function encodeRepositoryPath(owner: string, name: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function canonicalRepositoryUrl(host: string, owner: string, name: string): string {
  return `https://${host}/${encodeRepositoryPath(owner, name)}`;
}

function metadataContent(descriptor: RepositoryDescriptor): string {
  return [
    `Repository: ${descriptor.owner}/${descriptor.name}`,
    `Host: ${descriptor.host}`,
    `URL: ${descriptor.canonicalUrl}`,
    descriptor.description ? `Description: ${descriptor.description}` : null,
    descriptor.defaultBranch
      ? `Default branch: ${descriptor.defaultBranch}`
      : null,
    `Visibility: ${descriptor.visibility}`,
    descriptor.topics.length > 0
      ? `Topics: ${descriptor.topics.join(", ")}`
      : null,
    "Connector: repository metadata",
    "Ingestion scope: repository identity and metadata only; repository code was not cloned or indexed."
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function safeRepositoryUrl(
  value: string,
  resolveHostAddresses?: HostAddressResolver
): Promise<URL> {
  const url = await resolveSafeUrl(value, {
    resolveHostAddresses
  });

  if (url.pathname === "/" || url.pathname.trim().length === 0) {
    throw new IngestionError(
      "invalid_repository",
      "Repository URL must include owner and repository name."
    );
  }

  return url;
}

function parseRepositoryPath(url: URL): { owner: string; name: string } {
  const parts = url.pathname
    .split("/")
    .map((part) => decodeURIComponent(part.trim()))
    .filter(Boolean);

  if (parts.length < 2) {
    throw new IngestionError(
      "invalid_repository",
      "Repository URL must include owner and repository name."
    );
  }

  return {
    owner: validateRepositoryIdentity(parts[0], "owner"),
    name: validateRepositoryIdentity(stripGitSuffix(parts[1]), "name")
  };
}

function assertMatchingIdentity(
  input: RepositoryIngestionInput,
  parsed: { owner: string; name: string }
): void {
  if (input.owner && input.owner.toLowerCase() !== parsed.owner.toLowerCase()) {
    throw new IngestionError(
      "invalid_repository",
      "Repository owner does not match the repository URL."
    );
  }

  if (input.name && input.name.toLowerCase() !== parsed.name.toLowerCase()) {
    throw new IngestionError(
      "invalid_repository",
      "Repository name does not match the repository URL."
    );
  }
}

async function descriptorFromUrl(
  input: RepositoryIngestionInput,
  options: RepositoryLocationOptions
): Promise<RepositoryDescriptor> {
  const repositoryUrl = await safeRepositoryUrl(
    input.repositoryUrl ?? "",
    options.resolveHostAddresses
  );
  const parsed = parseRepositoryPath(repositoryUrl);

  assertMatchingIdentity(input, parsed);

  const canonicalUrl = canonicalRepositoryUrl(
    repositoryUrl.hostname.toLowerCase(),
    parsed.owner,
    parsed.name
  );

  return {
    host: repositoryUrl.hostname.toLowerCase(),
    owner: parsed.owner,
    name: parsed.name,
    canonicalUrl,
    description: input.description,
    defaultBranch: validateBranchName(input.defaultBranch),
    visibility: input.visibility ?? "unknown",
    topics: input.topics ?? [],
    resolvedAt: options.now ?? new Date()
  };
}

async function descriptorFromOwnerName(
  input: RepositoryIngestionInput,
  options: RepositoryLocationOptions
): Promise<RepositoryDescriptor> {
  if (!input.owner || !input.name) {
    throw new IngestionError(
      "invalid_repository",
      "Repository URL or owner and name are required."
    );
  }

  const host = input.host?.trim().toLowerCase() || defaultRepositoryHost;
  const owner = validateRepositoryIdentity(input.owner, "owner");
  const name = validateRepositoryIdentity(input.name, "name");
  const safeUrl = await safeRepositoryUrl(
    canonicalRepositoryUrl(host, owner, name),
    options.resolveHostAddresses
  );

  return {
    host: safeUrl.hostname.toLowerCase(),
    owner,
    name,
    canonicalUrl: canonicalRepositoryUrl(safeUrl.hostname.toLowerCase(), owner, name),
    description: input.description,
    defaultBranch: validateBranchName(input.defaultBranch),
    visibility: input.visibility ?? "unknown",
    topics: input.topics ?? [],
    resolvedAt: options.now ?? new Date()
  };
}

export function parseRepositoryIngestionPayload(
  payload: unknown,
  context: Pick<RepositoryIngestionInput, "organizationId" | "createdBy">
): RepositoryIngestionInput {
  if (!isRecord(payload)) {
    throw new IngestionError("invalid_payload", "Request body must be an object.");
  }

  const repositoryUrl = optionalString(payload.repositoryUrl);
  const owner = optionalString(payload.owner);
  const name = optionalString(payload.name);

  if (!repositoryUrl && (!owner || !name)) {
    throw new IngestionError(
      "invalid_repository",
      "Repository URL or owner and name are required."
    );
  }

  return {
    ...context,
    repositoryUrl,
    host: optionalString(payload.host),
    owner,
    name,
    description: optionalString(payload.description),
    defaultBranch: validateBranchName(optionalString(payload.defaultBranch)),
    visibility: parseVisibility(payload.visibility),
    topics: parseTopics(payload.topics),
    metadata: optionalMetadata(payload.metadata)
  };
}

export async function resolveRepositoryDescriptor(
  input: RepositoryIngestionInput,
  options: RepositoryLocationOptions = {}
): Promise<RepositoryDescriptor> {
  if (input.repositoryUrl) {
    return descriptorFromUrl(input, options);
  }

  return descriptorFromOwnerName(input, options);
}

export function createRepositoryIngestionResult(
  input: RepositoryIngestionInput,
  descriptor: RepositoryDescriptor
): NormalizedIngestionResult {
  const title = `Repository: ${descriptor.owner}/${descriptor.name}`;
  const content = metadataContent(descriptor);
  const contentHash = hashContent(content);
  const chunks = chunkText(content).map((chunkContent, chunkIndex) => ({
    chunkIndex,
    content: chunkContent,
    tokenCount: estimateTokenCount(chunkContent),
    metadata: {
      contentHash,
      repositoryUrl: descriptor.canonicalUrl,
      sourceScope: "metadata-only"
    }
  }));

  return {
    organizationId: input.organizationId,
    source: {
      type: "repository",
      name: `${descriptor.owner}/${descriptor.name}`,
      status: "ready",
      uri: descriptor.canonicalUrl,
      metadata: {
        host: descriptor.host,
        owner: descriptor.owner,
        name: descriptor.name,
        repositoryUrl: descriptor.canonicalUrl,
        description: descriptor.description,
        defaultBranch: descriptor.defaultBranch,
        visibility: descriptor.visibility,
        topics: descriptor.topics,
        sourceScope: "metadata-only",
        resolvedAt: descriptor.resolvedAt.toISOString(),
        ...(input.metadata ?? {})
      },
      createdBy: input.createdBy
    },
    document: {
      title,
      uri: descriptor.canonicalUrl,
      contentHash,
      status: "indexed",
      metadata: {
        sourceType: "repository",
        host: descriptor.host,
        owner: descriptor.owner,
        name: descriptor.name,
        repositoryUrl: descriptor.canonicalUrl,
        sourceScope: "metadata-only"
      }
    },
    chunks,
    citations: chunks.map((chunk) => ({
      label: `${descriptor.owner}/${descriptor.name} metadata #${
        chunk.chunkIndex + 1
      }`,
      uri: descriptor.canonicalUrl,
      chunkIndex: chunk.chunkIndex,
      metadata: {
        contentHash,
        repositoryUrl: descriptor.canonicalUrl,
        sourceScope: "metadata-only"
      }
    }))
  };
}

export async function ingestRepositoryMetadata(
  input: RepositoryIngestionInput,
  options: RepositoryLocationOptions = {}
): Promise<NormalizedIngestionResult> {
  return createRepositoryIngestionResult(
    input,
    await resolveRepositoryDescriptor(input, options)
  );
}
