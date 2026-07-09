import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://knowledgeos:knowledgeos@127.0.0.1:5432/knowledgeos"
  },
  strict: true,
  verbose: true
});
