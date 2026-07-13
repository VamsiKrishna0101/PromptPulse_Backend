import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!

export function generateAccessToken(userId: string): string {
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ?? '12h') as SignOptions['expiresIn']
  return jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn })
}

export function generateRefreshToken(userId: string): string {
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN ?? '30d') as SignOptions['expiresIn']
  return jwt.sign({ sub: userId }, REFRESH_SECRET, { expiresIn })
}
