import { Client } from 'pg'
import { config } from 'dotenv'
config()

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const res = await client.query('SELECT id, ai_model, prompt_id FROM "Chat"')
  console.log("All chats in DB:", res.rows)
  const prompts = await client.query('SELECT id, text, project_id FROM "Prompt"')
  console.log("All prompts in DB:", prompts.rows)
  await client.end()
}
main().catch(console.error)
