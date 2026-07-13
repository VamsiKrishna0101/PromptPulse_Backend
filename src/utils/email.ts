const BLOCKED_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com',
  'outlook.com', 'icloud.com', 'protonmail.com',
  'aol.com', 'zoho.com', 'gmx.com', 'mail.com'
]

export function isWorkEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return !BLOCKED_DOMAINS.includes(domain)
}

export function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}
