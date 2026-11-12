export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function acceptsDemoOtp(code: string, configuredProvider: string, issuedProvider: string): boolean {
  return configuredProvider === "demo" && issuedProvider === "demo" && isValidOtpCode(code);
}

export function isDemoOtpAllowed(nodeEnv: string | undefined, stagingEnabled: string | undefined): boolean {
  return nodeEnv === "development" || (nodeEnv === "staging" && stagingEnabled === "true");
}

export function assertOtpProviderAllowed(provider: string, nodeEnv: string | undefined, stagingEnabled: string | undefined): void {
  if (provider === "demo" && !isDemoOtpAllowed(nodeEnv, stagingEnabled)) {
    throw new Error("OTP_PROVIDER=demo is allowed only in development or explicitly enabled staging");
  }
}
