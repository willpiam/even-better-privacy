import { assert, assertEquals } from "jsr:@std/assert";
import { validatePassword } from "../core/PasswordPolicy.ts";

Deno.test("validatePassword accepts long mixed-class passwords", () => {
  const result = validatePassword("Correct-Horse-Battery-Staple-9!");
  assert(result.ok);
  assert(result.strength >= 3);
});

Deno.test("validatePassword rejects short passwords", () => {
  const result = validatePassword("Short-1!");
  assert(!result.ok);
  assert(result.suggestions.some((s) => s.includes("at least 12")));
});

Deno.test("validatePassword rejects common example passwords", () => {
  const result = validatePassword("password123");
  assert(!result.ok);
  assertEquals(
    result.reason,
    "Password does not meet the EBP password policy.",
  );
});

Deno.test("validatePassword requires at least three character classes", () => {
  const result = validatePassword("alllowercasepassword");
  assert(!result.ok);
  assert(result.suggestions.some((s) => s.includes("three of")));
});
