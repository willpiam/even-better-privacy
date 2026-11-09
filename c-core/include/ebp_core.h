#ifndef EBP_CORE_H
#define EBP_CORE_H
#include <stddef.h>
#include <stdint.h>

/* All buffers returned by this API must be freed with ebp_free. */
void ebp_free(void *p);
int ebp_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
/* EBP v4 binary layout: version || 16-byte salt || 12-byte IV || ciphertext || 16-byte tag.
 * The key is already derived by the caller. The salt is stored verbatim. */
int ebp_aes_encrypt(const uint8_t key[32], const uint8_t salt[16],
                    const uint8_t *plaintext, size_t plaintext_len,
                    const uint8_t *aad, size_t aad_len,
                    uint8_t **out, size_t *out_len);
/* Reads versions 1-4; AAD is applied only to version 4, as in TypeScript. */
int ebp_aes_decrypt(const uint8_t key[32], const uint8_t *blob, size_t blob_len,
                    const uint8_t *aad, size_t aad_len,
                    uint8_t **out, size_t *out_len);
#endif
