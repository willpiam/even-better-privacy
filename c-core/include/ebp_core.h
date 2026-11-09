#ifndef EBP_CORE_H
#define EBP_CORE_H
#include <stddef.h>
#include <stdint.h>

/* All buffers returned by this API must be freed with ebp_free. */
void ebp_free(void *p);
/* Current storage KDF: Argon2id v1.3, 64 MiB, 3 passes, one lane. */
int ebp_derive_storage_key(const uint8_t *password, size_t password_len,
                           const uint8_t salt[16], uint8_t out[32]);
int ebp_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
/* EBP v4 binary layout: version || 16-byte salt || 12-byte IV || ciphertext || 16-byte tag.
 * The key is already derived by the caller. The salt is stored verbatim. */
int ebp_aes_encrypt(const uint8_t key[32], const uint8_t salt[16],
                    const uint8_t *plaintext, size_t plaintext_len,
                    const uint8_t *aad, size_t aad_len,
                    uint8_t **out, size_t *out_len);
/* Reads version 4 only. */
int ebp_aes_decrypt(const uint8_t key[32], const uint8_t *blob, size_t blob_len,
                    const uint8_t *aad, size_t aad_len,
                    uint8_t **out, size_t *out_len);
/* Current purpose-separated signature envelope for a UTF-8 message. */
enum ebp_signature_purpose { EBP_MESSAGE = 1, EBP_DETAIL_PROOF = 2, EBP_REVOCATION = 3, EBP_HIERARCHY = 4 };
int ebp_message_envelope(int purpose, const uint8_t *message, size_t message_len,
                         const uint8_t *salt, size_t salt_len, uint8_t **out, size_t *out_len);
int ebp_recipient_envelope(const uint8_t *recipient, size_t recipient_len,
                           const uint8_t *message, size_t message_len,
                           const uint8_t *salt, size_t salt_len, uint8_t **out, size_t *out_len);
/* Output must have space for 65 bytes (64 characters and a terminator). */
int ebp_identity_fingerprint(int sphincs, const uint8_t *signing_key, size_t signing_key_len,
                             const uint8_t *encryption_key, size_t encryption_key_len, char out[65]);
/* HD nodes are 32-byte key || 32-byte chain code. */
int ebp_hd_master(const uint8_t *seed, size_t seed_len, uint8_t node[64]);
int ebp_hd_child(const uint8_t parent[64], uint32_t child_index, uint32_t child_depth, uint8_t node[64]);
int ebp_hd_identity_seeds(const uint8_t node[64], int sphincs,
                          uint8_t *sign_seed, size_t sign_seed_len, uint8_t kem_seed[64]);
/* Experimental current identity profiles; private buffers require ebp_secure_free. */
enum ebp_pq_algorithm { EBP_ML_DSA_87 = 1, EBP_SLH_DSA_SHA2_256S = 2, EBP_ML_KEM_1024 = 3 };
void ebp_secure_free(void *p, size_t len);
int ebp_pq_keygen(int algorithm, const uint8_t *seed, size_t seed_len,
                  uint8_t **pub, size_t *pub_len, uint8_t **priv, size_t *priv_len);
int ebp_pq_sign(int algorithm, const uint8_t *private_key, size_t private_len,
                const uint8_t *message, size_t message_len, uint8_t **signature, size_t *signature_len);
int ebp_pq_verify(int algorithm, const uint8_t *public_key, size_t public_len,
                  const uint8_t *message, size_t message_len, const uint8_t *signature, size_t signature_len);
int ebp_pq_encapsulate(const uint8_t *public_key, size_t public_len,
                       uint8_t **ciphertext, size_t *ciphertext_len, uint8_t secret[32]);
/* ML-KEM-1024 ciphertext || 12-byte nonce || AES-256-GCM ciphertext and tag. */
int ebp_kem_encrypt(const uint8_t *public_key, size_t public_len, const uint8_t *plaintext, size_t plaintext_len,
                    uint8_t **out, size_t *out_len);
int ebp_kem_decrypt(const uint8_t *private_key, size_t private_len, const uint8_t *ciphertext, size_t ciphertext_len,
                    uint8_t **out, size_t *out_len);
int ebp_pq_decapsulate(const uint8_t *private_key, size_t private_len,
                       const uint8_t *ciphertext, size_t ciphertext_len, uint8_t secret[32]);
#endif
