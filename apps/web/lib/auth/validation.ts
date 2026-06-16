const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function getEmailValidationError(email: string) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    return "Enter your email address."
  }

  if (!emailPattern.test(normalizedEmail)) {
    return "Enter a valid email address."
  }

  return null
}
