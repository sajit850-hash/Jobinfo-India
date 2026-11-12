import assert from "node:assert/strict";
import test from "node:test";
import { isValidOtpCode } from "./otp-policy";

test("accepts exactly six numeric OTP digits", () => {
  for (const code of ["123456", "654321", "111111", "987654", "000000"]) {
    assert.equal(isValidOtpCode(code), true, `${code} should be valid`);
  }
  for (const code of ["12345", "1234567", "12a456", "１２３４５６", ""]) {
    assert.equal(isValidOtpCode(code), false, `${code} should be invalid`);
  }
});
