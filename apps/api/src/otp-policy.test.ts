import assert from "node:assert/strict";
import test from "node:test";
import { acceptsDemoOtp, assertOtpProviderAllowed, isDemoOtpAllowed, isValidOtpCode } from "./otp-policy";

test("accepts exactly six numeric OTP digits", () => {
  for (const code of ["123456", "654321", "111111", "987654", "000000"]) {
    assert.equal(isValidOtpCode(code), true, `${code} should be valid`);
  }
  for (const code of ["12345", "1234567", "12a456", "１２３４５６", ""]) {
    assert.equal(isValidOtpCode(code), false, `${code} should be invalid`);
  }
});

test("demo OTP is limited to development or explicitly enabled staging", () => {
  assert.equal(isDemoOtpAllowed("development", undefined), true);
  assert.equal(isDemoOtpAllowed("staging", "true"), true);
  assert.equal(isDemoOtpAllowed("staging", "false"), false);
  assert.equal(isDemoOtpAllowed("production", "true"), false);
  assert.equal(isDemoOtpAllowed("test", undefined), false);
  assert.equal(isDemoOtpAllowed(undefined, undefined), false);
  assert.throws(() => assertOtpProviderAllowed("demo", "production", "true"), /development or explicitly enabled staging/);
  assert.throws(() => assertOtpProviderAllowed("demo", "test", undefined), /development or explicitly enabled staging/);
  assert.doesNotThrow(() => assertOtpProviderAllowed("demo", "development", undefined));
  assert.doesNotThrow(() => assertOtpProviderAllowed("console", "production", undefined));
});

test("arbitrary OTPs are accepted only for an unexpired demo-provider phone code", () => {
  for (const code of ["123456", "654321", "111111", "987654"]) {
    assert.equal(acceptsDemoOtp(code, "demo", "demo"), true);
  }
  assert.equal(acceptsDemoOtp("12345", "demo", "demo"), false);
  assert.equal(acceptsDemoOtp("1234567", "demo", "demo"), false);
  assert.equal(acceptsDemoOtp("12a456", "demo", "demo"), false);
  assert.equal(acceptsDemoOtp("123456", "console", "demo"), false);
  assert.equal(acceptsDemoOtp("123456", "demo", "console"), false);
});
