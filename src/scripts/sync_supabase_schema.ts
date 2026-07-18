import "dotenv/config"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Client } from "pg"

const migrationsDir = path.join(process.cwd(), "prisma", "migrations")

async function main() {
    if (process.env.SUPABASE_SCHEMA_SYNC_CONFIRM !== "reset-public-schema") {
        throw new Error("Set SUPABASE_SCHEMA_SYNC_CONFIRM=reset-public-schema to reset and sync the public schema.")
    }

    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("DATABASE_URL is required")

    const schemaSql = generateCurrentSchemaSql()
    const client = new Client({
        connectionString,
        ssl: connectionString.includes("supabase.co")
            ? { rejectUnauthorized: false }
            : undefined
    })

    await client.connect()
    try {
        await client.query("drop schema if exists public cascade")
        await client.query("create schema public")
        await client.query("grant all on schema public to postgres")
        await client.query("grant all on schema public to public")
        await client.query(schemaSql)
        await ensureMigrationsTable(client)
        await markExistingMigrationsAsApplied(client)

        const tables = await client.query<{ tablename: string }>(
            "select tablename from pg_tables where schemaname = 'public' order by tablename"
        )

        console.log(JSON.stringify({
            ok: true,
            tables_created: tables.rows.map(row => row.tablename)
        }, null, 2))
    } finally {
        await client.end()
    }
}

function generateCurrentSchemaSql() {
    const command = process.platform === "win32" ? "npx.cmd" : "npx"
    const raw = execFileSync(command, [
        "prisma",
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema",
        path.join("prisma", "schema.prisma"),
        "--script"
    ], {
        cwd: process.cwd(),
        encoding: "utf8",
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"]
    })

    return raw
        .split(/\r?\n/)
        .filter(line => !line.startsWith("Loaded Prisma config"))
        .join("\n")
        .trim()
}

async function ensureMigrationsTable(client: Client) {
    await client.query(`
        create table if not exists "_prisma_migrations" (
            id varchar(36) primary key,
            checksum varchar(64) not null,
            finished_at timestamptz,
            migration_name varchar(255) not null,
            logs text,
            rolled_back_at timestamptz,
            started_at timestamptz not null default now(),
            applied_steps_count integer not null default 0
        )
    `)
}

async function markExistingMigrationsAsApplied(client: Client) {
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true })
    const migrationNames = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()

    for (const migrationName of migrationNames) {
        const sqlPath = path.join(migrationsDir, migrationName, "migration.sql")
        const sql = await fs.readFile(sqlPath, "utf8")
        const checksum = crypto.createHash("sha256").update(sql).digest("hex")
        await client.query(
            `insert into "_prisma_migrations"
                (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
             values ($1, $2, $3, now(), now(), 1)
             on conflict (id) do nothing`,
            [crypto.randomUUID(), checksum, migrationName]
        )
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
