import { describe, expect, it } from "vitest";

import { IngestionError } from "./errors";
import {
  createRepositoryIngestionResult,
  ingestRepositoryMetadata,
  parseRepositoryIngestionPayload,
  resolveRepositoryDescriptor
} from "./repository";

const context = {
  organizationId: "org_1",
  createdBy: "user_1"
};

const publicResolver = async () => [
  {
    address: "93.184.216.34",
    family: 4
  }
];

describe("parseRepositoryIngestionPayload", () => {
  it("accepts repository URL payloads", () => {
    expect(
      parseRepositoryIngestionPayload(
        {
          repositoryUrl: "https://example.com/acme/knowledgeos",
          description: "Governed knowledge workspace",
          topics: ["RAG", "AI", "rag"]
        },
        context
      )
    ).toMatchObject({
      organizationId: "org_1",
      createdBy: "user_1",
      repositoryUrl: "https://example.com/acme/knowledgeos",
      topics: ["rag", "ai"]
    });
  });

  it("requires repository URL or owner and name", () => {
    expect(() => parseRepositoryIngestionPayload({}, context)).toThrow(
      "Repository URL or owner and name are required."
    );
  });
});

describe("repository metadata safety", () => {
  it("rejects unsafe repository URLs before normalization", async () => {
    await expect(
      resolveRepositoryDescriptor(
        {
          ...context,
          repositoryUrl: "http://localhost:3000/acme/secret"
        },
        {
          resolveHostAddresses: publicResolver
        }
      )
    ).rejects.toMatchObject({
      code: "unsafe_url"
    });
  });

  it("rejects repository hosts that resolve to private addresses", async () => {
    await expect(
      resolveRepositoryDescriptor(
        {
          ...context,
          repositoryUrl: "https://internal.example/acme/secret"
        },
        {
          resolveHostAddresses: async () => [
            {
              address: "10.0.0.3",
              family: 4
            }
          ]
        }
      )
    ).rejects.toMatchObject({
      code: "unsafe_url"
    });
  });

  it("rejects invalid owner or repository names", async () => {
    await expect(
      resolveRepositoryDescriptor(
        {
          ...context,
          owner: "../acme",
          name: "knowledgeos",
          host: "example.com"
        },
        {
          resolveHostAddresses: publicResolver
        }
      )
    ).rejects.toThrow(IngestionError);
  });
});

describe("repository metadata ingestion", () => {
  it("resolves repository URL identity without cloning code", async () => {
    const descriptor = await resolveRepositoryDescriptor(
      {
        ...context,
        repositoryUrl: "https://example.com/acme/knowledgeos.git",
        description: "Enterprise knowledge operating system",
        defaultBranch: "main",
        visibility: "public",
        topics: ["rag", "citations"]
      },
      {
        resolveHostAddresses: publicResolver,
        now: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(descriptor).toEqual({
      host: "example.com",
      owner: "acme",
      name: "knowledgeos",
      canonicalUrl: "https://example.com/acme/knowledgeos",
      description: "Enterprise knowledge operating system",
      defaultBranch: "main",
      visibility: "public",
      topics: ["rag", "citations"],
      resolvedAt: new Date("2026-07-09T00:00:00.000Z")
    });
  });

  it("normalizes owner/name metadata into source, document, chunks, and citations", async () => {
    const ingestion = await ingestRepositoryMetadata(
      {
        ...context,
        host: "example.com",
        owner: "patrick892368",
        name: "KnowledgeOS",
        description: "AI-native knowledge management",
        defaultBranch: "main",
        visibility: "public",
        metadata: {
          connector: "manual-repository"
        }
      },
      {
        resolveHostAddresses: publicResolver,
        now: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(ingestion).toMatchObject({
      organizationId: "org_1",
      source: {
        type: "repository",
        name: "patrick892368/KnowledgeOS",
        uri: "https://example.com/patrick892368/KnowledgeOS",
        metadata: {
          connector: "manual-repository",
          sourceScope: "metadata-only",
          owner: "patrick892368",
          name: "KnowledgeOS"
        }
      },
      document: {
        title: "Repository: patrick892368/KnowledgeOS",
        metadata: {
          sourceType: "repository",
          sourceScope: "metadata-only"
        }
      }
    });
    expect(ingestion.chunks).toHaveLength(1);
    expect(ingestion.chunks[0]?.content).toContain(
      "repository code was not cloned or indexed"
    );
    expect(ingestion.citations[0]).toMatchObject({
      label: "patrick892368/KnowledgeOS metadata #1",
      uri: "https://example.com/patrick892368/KnowledgeOS"
    });
  });

  it("creates ingestion from an already resolved descriptor", () => {
    const result = createRepositoryIngestionResult(
      {
        ...context,
        repositoryUrl: "https://example.com/acme/repo"
      },
      {
        host: "example.com",
        owner: "acme",
        name: "repo",
        canonicalUrl: "https://example.com/acme/repo",
        visibility: "unknown",
        topics: [],
        resolvedAt: new Date("2026-07-09T00:00:00.000Z")
      }
    );

    expect(result.source.type).toBe("repository");
    expect(result.document.contentHash).toHaveLength(64);
  });
});
