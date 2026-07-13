import "dotenv/config"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Client } from "pg"

const migrationsDir = path.join(process.cwd(), "prisma", "migrations")

async function main() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("DATABASE_URL is required")

    const client = new Client({
        connectionString,
        ssl: connectionString.includes("supabase.co")
            ? { rejectUnauthorized: false }
            : undefined
    })

    await client.connect()
    try {
        await ensureMigrationsTable(client)

        const entries = await fs.readdir(migrationsDir, { withFileTypes: true })
        const migrationNames = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort()

        const applied = await getAppliedMigrationNames(client)
        const results = []

        for (const migrationName of migrationNames) {
            if (applied.has(migrationName)) {
                results.push({ migration: migrationName, status: "already_applied" })
                continue
            }

            const sqlPath = path.join(migrationsDir, migrationName, "migration.sql")
            const sql = await fs.readFile(sqlPath, "utf8")
            const checksum = crypto.createHash("sha256").update(sql).digest("hex")
            const migrationId = crypto.randomUUID()
            const startedAt = new Date()

            await client.query("BEGIN")
            try {
                await client.query(
                    `insert into "_prisma_migrations"
                        (id, checksum, migration_name, started_at, applied_steps_count)
                     values ($1, $2, $3, $4, 0)`,
                    [migrationId, checksum, migrationName, startedAt]
                )
                await client.query(sql)
                await client.query(
                    `update "_prisma_migrations"
                     set finished_at = now(), applied_steps_count = 1
                     where id = $1`,
                    [migrationId]
                )
                await client.query("COMMIT")
                results.push({ migration: migrationName, status: "applied" })
            } catch (error) {
                await client.query("ROLLBACK")
                throw error
            }
        }

        console.log(JSON.stringify({
            ok: true,
            migrations: results
        }, null, 2))
    } finally {
        await client.end()
    }
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

async function getAppliedMigrationNames(client: Client) {
    const result = await client.query<{ migration_name: string }>(
        `select migration_name from "_prisma_migrations" where finished_at is not null and rolled_back_at is null`
    )
    return new Set(result.rows.map(row => row.migration_name))
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
