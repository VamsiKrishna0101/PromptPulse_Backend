import "dotenv/config"
import prisma from "../lib/prisma"

type TableRow = { tablename: string }
type CountRow = { count: bigint }

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

    const counts = []
    for (const row of tables) {
        const result = await prisma.$queryRawUnsafe<CountRow[]>(
            `select count(*)::bigint as count from ${quoteIdent(row.tablename)}`
        )
        counts.push({ table: row.tablename, count: Number(result[0]?.count ?? 0) })
    }

    console.log(JSON.stringify(counts, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
