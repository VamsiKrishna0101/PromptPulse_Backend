import "dotenv/config"
import prisma from "../lib/prisma"
const KEEP_TABLES = new Set(["User", "_prisma_migrations"])

type TableRow = { tablename: string }
type CountRow = { tablename: string; count: bigint }

function quoteIdent(value: string) {
    return `"${value.replace(/"/g, '""')}"`
}

async function main() {
    const tables = await prisma.$queryRaw<TableRow[]>`
        select tablename
        from pg_tables
        where schemaname = 'public'
        order by tablename
    `

    const tablesToTruncate = tables
        .map(row => row.tablename)
        .filter(table => !KEEP_TABLES.has(table))

    if (tablesToTruncate.length > 0) {
        await prisma.$executeRawUnsafe(
            `TRUNCATE TABLE ${tablesToTruncate.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`
        )
    }

    const counts = await prisma.$queryRaw<CountRow[]>`
        select
            c.relname as tablename,
            c.reltuples::bigint as count
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
        order by c.relname
    `

    console.log(JSON.stringify({
        preserved: Array.from(KEEP_TABLES),
        truncated: tablesToTruncate,
        estimated_counts: counts.map(row => ({
            table: row.tablename,
            estimated_count: Number(row.count),
        })),
    }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
