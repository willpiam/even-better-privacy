export type PasswordValidationResult =
  | { ok: true; strength: number }
  | {
    ok: false;
    reason: string;
    suggestions: string[];
    strength: number;
  };

const MIN_PASSWORD_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "qwerty",
  "qwerty123",
  "letmein",
  "welcome",
  "welcome123",
  "admin",
  "admin123",
  "correcthorsebatterystaple",
  "iloveyou",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "abc123",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
]);

export type PasswordPolicyOptions = {
  /** When false, only require a non-empty password (GUI opt-out). Default true. */
  enforcePolicy?: boolean;
};

export function validatePassword(
  password: string,
  options: PasswordPolicyOptions = {},
): PasswordValidationResult {
  if (options.enforcePolicy === false) {
    if (!password) {
      return {
        ok: false,
        reason: "Password is required.",
        suggestions: [],
        strength: 0,
      };
    }
    return { ok: true, strength: scorePasswordStrength(password) };
  }

  const suggestions: string[] = [];
  const normalized = password.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    suggestions.push(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (COMMON_PASSWORDS.has(normalized)) {
    suggestions.push("Avoid common or example passwords.");
  }

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
  if (classes < 3) {
    suggestions.push(
      "Use at least three of: lowercase, uppercase, digits, symbols.",
    );
  }

  const strength = scorePasswordStrength(password, classes);
  if (suggestions.length > 0) {
    return {
      ok: false,
      reason: "Password does not meet the EBP password policy.",
      suggestions,
      strength,
    };
  }

  return { ok: true, strength };
}

export function scorePasswordStrength(
  password: string,
  classes?: number,
): number {
  const classCount = classes ?? [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  let charset = 0;
  if (/[a-z]/.test(password)) charset += 26;
  if (/[A-Z]/.test(password)) charset += 26;
  if (/[0-9]/.test(password)) charset += 10;
  if (/[^A-Za-z0-9]/.test(password)) charset += 32;

  const entropy = password.length * Math.log2(Math.max(charset, 1));
  if (
    password.length >= MIN_PASSWORD_LENGTH && classCount >= 3 && entropy >= 90
  ) return 4;
  if (
    password.length >= MIN_PASSWORD_LENGTH && classCount >= 3 && entropy >= 70
  ) return 3;
  if (password.length >= 10 && classCount >= 2 && entropy >= 50) return 2;
  if (password.length >= 8) return 1;
  return 0;
}
