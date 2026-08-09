import dotenv from "dotenv"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const candidatePaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../../agents/.env"),
  path.resolve(__dirname, "../../.env"),
]

for (const envPath of candidatePaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false })
  }
}
