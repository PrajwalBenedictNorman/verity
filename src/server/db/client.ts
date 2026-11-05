import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function getUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

const globalForDb = globalThis as unknown as {
  sql?: ReturnType<typeof postgres>;
};

export function getSql() {
  if (!globalForDb.sql) {
    globalForDb.sql = postgres(getUrl(), { max: 10 });
  }
  return globalForDb.sql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

export type Db = ReturnType<typeof getDb>;
