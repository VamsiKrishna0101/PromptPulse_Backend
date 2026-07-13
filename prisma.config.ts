import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder"
const ssl = connectionString.includes("supabase.co")
  ? { rejectUnauthorized: false }
  : undefined

export default defineConfig({
  earlyAccess: true,
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: connectionString,
  },
  migrate: {
    async adapter() {
      return new PrismaPg({ connectionString, ssl })
    },
  },
})
