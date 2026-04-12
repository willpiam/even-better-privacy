// =============================================================================
// Security Limits
// =============================================================================

/** Maximum request body size in bytes (512KB) */
export const MAX_BODY_SIZE = 512 * 1024;

/** Field length limits */
export const LIMITS = {
  fingerprint: 128,         // Bech32 fingerprint (HRP + payload + checksum)
  path: 256,                // Detail path
  detail: 8192,             // Detail value (8KB)
  message: 100_000,         // Message payload for signature verification
  signature: 100_000,       // Post-quantum signatures are large
  proof: 100_000,           // Proof/certificate can be large due to signatures
  certificate: 300_000,     // Certificates can include two large PQ signatures
  reason: 1024,             // Revocation reason
  signingKey: 50_000,       // Post-quantum keys are large
  encryptionKey: 50_000,
  stateSignature: 50_000,
  stateHash: 128,           // SHA-256 hex
  searchQuery: 256,         // Search query string
  verificationToken: 256,   // Email verification token
};

// =============================================================================
// Body Parsing with Size Limit
// =============================================================================

/**
 * Safely read and parse JSON body with size limit
 */
export async function readJsonBody<T>(req: Request): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    return { ok: false, error: `payload too large (max ${MAX_BODY_SIZE} bytes)`, status: 413 };
  }
  
  try {
    const reader = req.body?.getReader();
    if (!reader) {
      return { ok: false, error: "missing request body", status: 400 };
    }
    
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      totalSize += value.length;
      if (totalSize > MAX_BODY_SIZE) {
        reader.cancel();
        return { ok: false, error: `payload too large (max ${MAX_BODY_SIZE} bytes)`, status: 413 };
      }
      chunks.push(value);
    }
    
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    const text = new TextDecoder().decode(combined);
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, error: "invalid json", status: 400 };
    }
    return { ok: false, error: "failed to read request body", status: 400 };
  }
}

// =============================================================================
// Field Validation
// =============================================================================

/**
 * Validate string field length
 */
export function validateStringLength(
  value: unknown,
  fieldName: string,
  maxLength: number,
  required = true
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    if (required) {
      return { ok: false, error: `missing ${fieldName}` };
    }
    return { ok: true, value: "" };
  }
  
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  
  if (required && value.length === 0) {
    return { ok: false, error: `${fieldName} cannot be empty` };
  }
  
  if (value.length > maxLength) {
    return { ok: false, error: `${fieldName} too long (max ${maxLength} characters)` };
  }
  
  return { ok: true, value };
}
