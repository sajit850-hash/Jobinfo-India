export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}
