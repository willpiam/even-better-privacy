export const EMAIL_VERIFY_REQUEST_PATH = "ebp-mail::verify-email";
export function verificationRequestDetail(path: string, email: string): string {
  return JSON.stringify([path, email]);
}
