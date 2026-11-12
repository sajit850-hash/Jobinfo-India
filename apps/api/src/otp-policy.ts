export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

export function acceptsDemoOtp(code: string, configuredProvider: string, issuedProvider: string): boolean {
  return configuredProvider === "demo" && issuedProvider === "demo" && isValidOtpCode(code);
}

export function isDemoOtpAllowed(
  nodeEnv: string | undefined,
  stagingEnabled: string | undefined,
  productionEnabled: string | undefined = undefined,
): boolean {
  return nodeEnv === "development"
    || (nodeEnv === "staging" && stagingEnabled === "true")
    || (nodeEnv === "production" && productionEnabled === "true");
}

export function assertOtpProviderAllowed(
  provider: string,
  nodeEnv: string | undefined,
  stagingEnabled: string | undefined,
  productionEnabled: string | undefined = undefined,
): void {
  if (provider === "demo" && !isDemoOtpAllowed(nodeEnv, stagingEnabled, productionEnabled)) {
    throw new Error("OTP_PROVIDER=demo requires development mode or an explicit staging/production opt-in");
  }
}
