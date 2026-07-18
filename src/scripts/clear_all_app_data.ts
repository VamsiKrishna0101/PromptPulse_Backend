import "../lib/env"
import prisma from "../lib/prisma"

const KEEP_TABLES = new Set(["_prisma_migrations"])

type TableRow = { tablename: string }

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

    console.log(`Truncated ${tablesToTruncate.length} tables`)
    console.log(`Preserved ${Array.from(KEEP_TABLES).join(", ")}`)
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
