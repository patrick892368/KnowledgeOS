import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { IngestionError } from "./errors";
import { chunkText, estimateTokenCount } from "./chunk-text";
import { hashContent } from "./local-note";
import type { NormalizedIngestionResult } from "./types";

export interface UrlIngestionInput {
  organizationId: string;
  createdBy: string;
  url: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface UrlFetchResult {
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  content: string;
  contentType: string;
  fetchedAt: Date;
}

export type HostAddressResolver = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

export type UrlFetcher = (
  input: string,
  init: RequestInit
) => Promise<Response>;

export interface FetchUrlContentOptions {
  fetcher?: UrlFetcher;
  resolveHostAddresses?: HostAddressResolver;
  now?: Date;
}

const maxRedirects = 3;
const maxContentCharacters = 200_000;
const fetchTimeoutMs = 8_000;
const supportedContentTypes = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown"
];

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

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function parseIpv4Address(address: string): number[] | null {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));

  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      String(octet) === parts[index]
  )
    ? octets
    : null;
}

function isUnsafeIpv4(address: string): boolean {
  const octets = parseIpv4Address(address);

  if (!octets) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function normalizeIpv6(address: string): string {
  return stripIpv6Brackets(address).toLowerCase();
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = normalizeIpv6(address);

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff")
  ) {
    return true;
  }

  const ipv4Mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);

  return ipv4Mapped ? isUnsafeIpv4(ipv4Mapped[1]) : false;
}

export function isUnsafeIpAddress(address: string): boolean {
  const normalized = stripIpv6Brackets(address);
  const family = isIP(normalized);

  if (family === 4) {
    return isUnsafeIpv4(normalized);
  }

  if (family === 6) {
    return isUnsafeIpv6(normalized);
  }

  return true;
}

function normalizeCandidateUrl(value: string, baseUrl?: string): URL {
  let url: URL;

  try {
    url = baseUrl ? new URL(value, baseUrl) : new URL(value);
  } catch {
    throw new IngestionError("invalid_url", "URL must be a valid HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new IngestionError("invalid_url", "URL must use http or https.");
  }

  if (url.username || url.password) {
    throw new IngestionError("invalid_url", "URL credentials are not allowed.");
  }

  const hostname = stripIpv6Brackets(url.hostname.toLowerCase());

  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new IngestionError("unsafe_url", "Localhost URLs are not allowed.");
  }

  if (isIP(hostname) && isUnsafeIpAddress(hostname)) {
    throw new IngestionError(
      "unsafe_url",
      "Local, private, or reserved network URLs are not allowed."
    );
  }

  return url;
}

async function defaultResolveHostAddresses(hostname: string) {
  return dnsLookup(hostname, {
    all: true,
    verbatim: true
  });
}

async function assertPublicResolvedAddresses(
  url: URL,
  resolveHostAddresses: HostAddressResolver
): Promise<void> {
  if (isIP(stripIpv6Brackets(url.hostname))) {
    return;
  }

  let addresses: Array<{ address: string; family: number }>;

  try {
    addresses = await resolveHostAddresses(url.hostname);
  } catch {
    throw new IngestionError("fetch_failed", "URL host could not be resolved.");
  }

  if (addresses.length === 0) {
    throw new IngestionError("fetch_failed", "URL host could not be resolved.");
  }

  if (addresses.some((address) => isUnsafeIpAddress(address.address))) {
    throw new IngestionError(
      "unsafe_url",
      "URL resolves to a local, private, or reserved network address."
    );
  }
}

export async function resolveSafeUrl(
  value: string,
  options: {
    baseUrl?: string;
    resolveHostAddresses?: HostAddressResolver;
  } = {}
): Promise<URL> {
  const url = normalizeCandidateUrl(value, options.baseUrl);

  await assertPublicResolvedAddresses(
    url,
    options.resolveHostAddresses ?? defaultResolveHostAddresses
  );

  return url;
}

function readSupportedContentType(response: Response): string {
  const rawContentType = response.headers.get("content-type") ?? "text/plain";
  const contentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (!supportedContentTypes.includes(contentType)) {
    throw new IngestionError(
      "unsupported_content_type",
      "URL content type must be HTML, XHTML, plain text, or Markdown."
    );
  }

  return contentType;
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    receivedBytes += value.byteLength;

    if (receivedBytes > maxContentCharacters) {
      throw new IngestionError(
        "fetch_failed",
        "URL content is too large for synchronous ingestion."
      );
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]
    ?.replace(/\s+/g, " ")
    .trim();

  return title ? decodeHtmlEntities(title) : undefined;
}

export function extractReadableUrlText(
  body: string,
  contentType: string
): { title?: string; content: string } {
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    return {
      content: body.replace(/\r\n/g, "\n").trim()
    };
  }

  const title = extractHtmlTitle(body);
  const content = decodeHtmlEntities(
    body
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<title[\s\S]*?<\/title>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  return {
    title,
    content
  };
}

function titleFromUrl(url: URL): string {
  const pathSegment = url.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop();

  if (pathSegment) {
    return decodeURIComponent(pathSegment).replace(/[-_]+/g, " ");
  }

  return url.hostname;
}

export function parseUrlIngestionPayload(
  payload: unknown,
  context: Pick<UrlIngestionInput, "organizationId" | "createdBy">
): UrlIngestionInput {
  if (!isRecord(payload)) {
    throw new IngestionError("invalid_payload", "Request body must be an object.");
  }

  const url = optionalString(payload.url);

  if (!url) {
    throw new IngestionError("invalid_url", "A URL is required.");
  }

  return {
    ...context,
    url,
    title: optionalString(payload.title),
    metadata: optionalMetadata(payload.metadata)
  };
}

export async function fetchUrlContent(
  input: UrlIngestionInput,
  options: FetchUrlContentOptions = {}
): Promise<UrlFetchResult> {
  const fetcher = options.fetcher ?? fetch;
  const resolveHostAddresses =
    options.resolveHostAddresses ?? defaultResolveHostAddresses;
  const requestedUrl = await resolveSafeUrl(input.url, {
    resolveHostAddresses
  });
  let currentUrl = requestedUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let response: Response;

    try {
      response = await fetcher(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(fetchTimeoutMs),
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown",
          "user-agent": "KnowledgeOS-url-ingestion/0.1"
        }
      });
    } catch {
      throw new IngestionError("fetch_failed", "URL fetch failed.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (!location) {
        throw new IngestionError("fetch_failed", "URL redirect is missing location.");
      }

      currentUrl = await resolveSafeUrl(location, {
        baseUrl: currentUrl.toString(),
        resolveHostAddresses
      });
      continue;
    }

    if (!response.ok) {
      throw new IngestionError(
        "fetch_failed",
        `URL fetch failed with status ${response.status}.`
      );
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");

    if (contentLength > maxContentCharacters) {
      throw new IngestionError(
        "fetch_failed",
        "URL content is too large for synchronous ingestion."
      );
    }

    const contentType = readSupportedContentType(response);
    const body = await readResponseText(response);
    const extracted = extractReadableUrlText(body, contentType);

    if (!extracted.content.trim()) {
      throw new IngestionError(
        "empty_content",
        "URL did not contain extractable text content."
      );
    }

    return {
      requestedUrl: requestedUrl.toString(),
      finalUrl: currentUrl.toString(),
      title: extracted.title,
      content: extracted.content,
      contentType,
      fetchedAt: options.now ?? new Date()
    };
  }

  throw new IngestionError("fetch_failed", "URL redirect limit exceeded.");
}

export function createUrlIngestionResult(
  input: UrlIngestionInput,
  fetched: UrlFetchResult
): NormalizedIngestionResult {
  const finalUrl = new URL(fetched.finalUrl);
  const title =
    input.title?.trim() ||
    fetched.title?.trim() ||
    titleFromUrl(finalUrl).trim() ||
    finalUrl.hostname;
  const normalizedContent = fetched.content.trim();
  const contentHash = hashContent(normalizedContent);
  const chunks = chunkText(normalizedContent).map((content, chunkIndex) => ({
    chunkIndex,
    content,
    tokenCount: estimateTokenCount(content),
    metadata: {
      contentHash,
      finalUrl: fetched.finalUrl
    }
  }));

  return {
    organizationId: input.organizationId,
    source: {
      type: "url",
      name: title,
      status: "ready",
      uri: fetched.finalUrl,
      metadata: {
        requestedUrl: fetched.requestedUrl,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        fetchedAt: fetched.fetchedAt.toISOString(),
        ...(input.metadata ?? {})
      },
      createdBy: input.createdBy
    },
    document: {
      title,
      uri: fetched.finalUrl,
      contentHash,
      status: "indexed",
      metadata: {
        sourceType: "url",
        requestedUrl: fetched.requestedUrl,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType
      }
    },
    chunks,
    citations: chunks.map((chunk) => ({
      label: `${title} #${chunk.chunkIndex + 1}`,
      uri: fetched.finalUrl,
      chunkIndex: chunk.chunkIndex,
      metadata: {
        contentHash,
        finalUrl: fetched.finalUrl
      }
    }))
  };
}

export async function ingestUrl(
  input: UrlIngestionInput,
  options: FetchUrlContentOptions = {}
): Promise<NormalizedIngestionResult> {
  return createUrlIngestionResult(input, await fetchUrlContent(input, options));
}
