import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import {
  actionCovers,
  grantMatchesSessionSubject,
  roleAllowsAction
} from "@/auth/permissions";
import type { AuthSession } from "@/auth/session";
import {
  createLocalEmbedding,
  localEmbeddingModel,
  toPgVectorLiteral
} from "@/ai/embeddings";
import type { LocalSearchResponse, LocalSearchResult } from "@/search/types";

import type { Database } from "./client";
import {
  chunks,
  citations,
  documents,
  embeddings,
  permissionGrants,
  sources
} from "./schema";

export const hybridSemanticWeight = 4;

export interface DatabaseSearchInput {
  session: AuthSession;
  query: string;
  limit?: number;
}

type PersistedSearchRow = {
  score: number;
  chunkContent: string;
  chunkIndex: number;
  documentTitle: string;
  documentContentHash: string;
  sourceType: "note" | "document" | "url" | "repository" | "integration";
  sourceName: string;
  sourceUri: string | null;
  citationLabel: string;
  citationUri: string | null;
};

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    )
  );
}

function createSnippet(content: string, queryTokens: string[], maxLength = 220) {
  const lowerContent = content.toLowerCase();
  const firstHit = queryTokens
    .map((token) => lowerContent.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const start =
    firstHit === undefined ? 0 : Math.max(0, firstHit - Math.floor(maxLength / 3));
  const snippet = content.slice(start, start + maxLength).trim();

  return `${start > 0 ? "... " : ""}${snippet}${
    start + maxLength < content.length ? " ..." : ""
  }`;
}

export function isReadAllowedBySession(session: AuthSession): boolean {
  return roleAllowsAction(session.role, "read");
}

export function hasReadGrantForResource(
  session: AuthSession,
  grant: {
    organizationId: string;
    subjectType: "user" | "membership" | "role";
    subjectId: string;
    resourceType: "organization" | "source" | "document" | "workflow";
    resourceId: string;
    action: "read" | "write" | "admin";
  },
  resource: {
    organizationId: string;
    sourceId: string;
    documentId: string;
  }
): boolean {
  if (!grantMatchesSessionSubject(session, grant)) {
    return false;
  }

  if (!actionCovers(grant.action, "read")) {
    return false;
  }

  if (grant.organizationId !== resource.organizationId) {
    return false;
  }

  if (grant.resourceType === "organization") {
    return grant.resourceId === resource.organizationId;
  }

  if (grant.resourceType === "source") {
    return grant.resourceId === resource.sourceId;
  }

  if (grant.resourceType === "document") {
    return grant.resourceId === resource.documentId;
  }

  return false;
}

function scoreExpression(queryTokens: string[]) {
  const expressions = queryTokens.map((token) => {
    const pattern = `%${token}%`;
    return sql<number>`(
      case when lower(${documents.title}) like ${pattern} then 3 else 0 end +
      case when lower(${chunks.content}) like ${pattern} then 1 else 0 end
    )`;
  });

  return sql<number>`${sql.join(expressions, sql` + `)}`;
}

function semanticScoreExpression(queryVector: string) {
  return sql<number>`coalesce(1 - (${embeddings.embedding} <=> ${queryVector}::vector), 0)`;
}

export function combineHybridScore(
  keywordScore: number,
  semanticScore: number
): number {
  return keywordScore + semanticScore * hybridSemanticWeight;
}

function hybridScoreExpression(
  keywordScore: ReturnType<typeof scoreExpression>,
  semanticScore: ReturnType<typeof semanticScoreExpression>
) {
  return sql<number>`(${keywordScore} + (${semanticScore} * ${hybridSemanticWeight}))`;
}

function searchPredicate(queryTokens: string[]) {
  const predicates = queryTokens.flatMap((token) => {
    const pattern = `%${token}%`;
    return [ilike(documents.title, pattern), ilike(chunks.content, pattern)];
  });

  return or(...predicates);
}

function hybridCandidatePredicate(queryTokens: string[], semanticScore: ReturnType<typeof semanticScoreExpression>) {
  return or(searchPredicate(queryTokens), sql`${semanticScore} > 0.05`);
}

function permissionPredicate(session: AuthSession) {
  if (isReadAllowedBySession(session)) {
    return sql`true`;
  }

  return sql`exists (
    select 1
    from ${permissionGrants}
    where ${permissionGrants.organizationId} = ${chunks.organizationId}
      and ${permissionGrants.action} in ('read', 'write', 'admin')
      and (
        (${permissionGrants.subjectType} = 'user' and ${permissionGrants.subjectId} = ${session.userId})
        or (${permissionGrants.subjectType} = 'membership' and ${permissionGrants.subjectId} = ${session.membershipId ?? ""})
        or (${permissionGrants.subjectType} = 'role' and ${permissionGrants.subjectId} = ${session.role})
      )
      and (
        (${permissionGrants.resourceType} = 'organization' and ${permissionGrants.resourceId} = ${session.organizationId})
        or (${permissionGrants.resourceType} = 'source' and ${permissionGrants.resourceId} = ${sources.id}::text)
        or (${permissionGrants.resourceType} = 'document' and ${permissionGrants.resourceId} = ${documents.id}::text)
      )
  )`;
}

function toLocalSearchResult(
  row: PersistedSearchRow,
  queryTokens: string[]
): LocalSearchResult {
  return {
    score: row.score,
    snippet: createSnippet(row.chunkContent, queryTokens),
    source: {
      type: row.sourceType,
      name: row.sourceName,
      uri: row.sourceUri ?? undefined,
      documentTitle: row.documentTitle,
      documentContentHash: row.documentContentHash
    },
    citation: {
      label: row.citationLabel,
      uri: row.citationUri ?? undefined,
      chunkIndex: row.chunkIndex,
      documentTitle: row.documentTitle,
      contentHash: row.documentContentHash
    }
  };
}

export async function searchPersistedKnowledge(
  db: Database,
  input: DatabaseSearchInput
): Promise<LocalSearchResponse> {
  const query = input.query.trim();
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) {
    return {
      query,
      results: [],
      metrics: {
        searchedDocuments: 0,
        searchedChunks: 0,
        returnedResults: 0,
        citationCoverage: 1
      }
    };
  }

  const score = scoreExpression(queryTokens);
  const semanticScore = semanticScoreExpression(
    toPgVectorLiteral(createLocalEmbedding(query))
  );
  const hybridScore = hybridScoreExpression(score, semanticScore);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  const rows = await db
    .select({
      score: hybridScore,
      chunkContent: chunks.content,
      chunkIndex: chunks.chunkIndex,
      documentTitle: documents.title,
      documentContentHash: documents.contentHash,
      sourceType: sources.type,
      sourceName: sources.name,
      sourceUri: sources.uri,
      citationLabel: citations.label,
      citationUri: citations.uri
    })
    .from(chunks)
    .innerJoin(documents, eq(chunks.documentId, documents.id))
    .innerJoin(sources, eq(documents.sourceId, sources.id))
    .innerJoin(
      embeddings,
      and(
        eq(embeddings.chunkId, chunks.id),
        eq(embeddings.model, localEmbeddingModel)
      )
    )
    .innerJoin(citations, eq(citations.chunkId, chunks.id))
    .where(
      and(
        eq(chunks.organizationId, input.session.organizationId),
        hybridCandidatePredicate(queryTokens, semanticScore),
        permissionPredicate(input.session)
      )
    )
    .orderBy(desc(hybridScore))
    .limit(limit);

  const results = rows.map((row) =>
    toLocalSearchResult(row as PersistedSearchRow, queryTokens)
  );

  return {
    query,
    results,
    metrics: {
      searchedDocuments: new Set(rows.map((row) => row.documentContentHash)).size,
      searchedChunks: rows.length,
      returnedResults: results.length,
      citationCoverage:
        results.length === 0
          ? 1
          : results.filter((result) => result.citation.label).length /
            results.length
    }
  };
}
