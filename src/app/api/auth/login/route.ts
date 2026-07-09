import {
  authenticateBootstrapLoginWithIdentityBootstrap,
  BootstrapLoginError,
  bootstrapLoginErrorResponse
} from "@/auth/bootstrap-login";
import { createDatabaseClient } from "@/db/client";
import { bootstrapIdentityRecords } from "@/db/identity-bootstrap-repository";
import { createSessionCookieHeader } from "@/auth/session";

function shouldBootstrapIdentityInDatabase() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return bootstrapLoginErrorResponse(
      new BootstrapLoginError(
        "invalid_payload",
        "Login payload must be valid JSON."
      )
    );
  }

  try {
    const login = await authenticateBootstrapLoginWithIdentityBootstrap(payload, {
      bootstrapIdentity: shouldBootstrapIdentityInDatabase()
        ? async (input) => {
            try {
              return await bootstrapIdentityRecords(createDatabaseClient(), input);
            } catch (error) {
              throw new BootstrapLoginError(
                "identity_bootstrap_unavailable",
                error instanceof Error
                  ? error.message
                  : "Identity bootstrap database is unavailable."
              );
            }
          }
        : undefined
    });

    return Response.json(
      {
        session: {
          ...login.session,
          source: "signed-cookie"
        },
        expiresAt: login.expiresAt.toISOString(),
        identity: login.identity
      },
      {
        headers: {
          "Set-Cookie": createSessionCookieHeader(login.token, {
            maxAgeSeconds: login.maxAgeSeconds
          })
        }
      }
    );
  } catch (error) {
    return bootstrapLoginErrorResponse(error);
  }
}
