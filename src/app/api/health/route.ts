import { appMetadata } from "@/lib/app-metadata";

export function GET() {
  return Response.json({
    service: appMetadata.name,
    status: "ok",
    phase: appMetadata.phase
  });
}
