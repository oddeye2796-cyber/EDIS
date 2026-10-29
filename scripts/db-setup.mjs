// 스키마와 샘플 데이터를 DATABASE_URL 데이터베이스에 적용합니다.
import { readFileSync } from "node:fs";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query(readFileSync("db/schema.sql", "utf8"));
console.log("applied db/schema.sql");
const { rows } = await client.query("select count(*)::int as n from partners");
if (rows[0].n === 0) {
  await client.query(readFileSync("db/seed.sql", "utf8"));
  console.log("applied db/seed.sql");
  if (process.argv.includes("--demo")) {
    await client.query(readFileSync("db/demo.sql", "utf8"));
    console.log("applied db/demo.sql");
  }
} else {
  console.log("skip db/seed.sql (data exists)");
}
await client.end();
