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
/* Current EBP mnemonic format. Returned entropy and phrases are secret buffers. */
int ebp_entropy_to_mnemonic(const uint8_t *entropy, size_t entropy_len, uint8_t **phrase, size_t *phrase_len);
int ebp_mnemonic_to_entropy(const uint8_t *phrase, size_t phrase_len, uint8_t **entropy, size_t *entropy_len);
int ebp_mnemonic_to_seed(const uint8_t *phrase, size_t phrase_len,
                         const uint8_t *passphrase, size_t passphrase_len, uint8_t out[64]);
/* HD nodes are 32-byte key || 32-byte chain code. */
int ebp_hd_master(const uint8_t *seed, size_t seed_len, uint8_t node[64]);
int ebp_hd_child(const uint8_t parent[64], uint32_t child_index, uint32_t child_depth, uint8_t node[64]);
int ebp_hd_identity_seeds(const uint8_t node[64], int sphincs,
                          uint8_t *sign_seed, size_t sign_seed_len, uint8_t kem_seed[64]);
/* File envelopes operate on bytes; paths and file access remain with the caller. */
int ebp_file_envelope_create(const uint8_t *file, size_t file_len, const uint8_t *name, size_t name_len,
                             const uint8_t *mime, size_t mime_len, uint8_t **json, size_t *json_len);
int ebp_file_envelope_parse(const uint8_t *json, size_t json_len, uint8_t **file, size_t *file_len,
                            uint8_t **name, size_t *name_len, uint8_t **mime, size_t *mime_len);
/* Parse and armor current-version payload JSON. Parsing checks the type and version,
 * but does not authenticate signatures, recipients, or payload fields. */
int ebp_payload_parse(const uint8_t *input, size_t input_len, uint8_t **json, size_t *json_len);
int ebp_payload_armor(const uint8_t *json, size_t json_len, uint8_t **armored, size_t *armored_len);
/* An identity owns its key material; private objects must be released with ebp_identity_free. */
typedef struct ebp_identity ebp_identity;
int ebp_identity_create(int sphincs, ebp_identity **out);
int ebp_identity_from_hd_seed(const uint8_t *seed, size_t seed_len, int sphincs,
                              uint32_t account, int change, uint32_t index, ebp_identity **out);
int ebp_identity_public_json(const ebp_identity *identity, uint8_t **json, size_t *json_len);
/* Imports a public-data or current public-export object containing both public keys. */
int ebp_identity_from_public_json(const uint8_t *json, size_t json_len, ebp_identity **out);
int ebp_identity_store(const ebp_identity *identity, const uint8_t *password, size_t password_len,
                       uint8_t **json, size_t *json_len);
/* unlock=0 loads only public metadata; unlock=1 requires a password. */
int ebp_identity_load(const uint8_t *json, size_t json_len, const uint8_t *password, size_t password_len,
                      int unlock, ebp_identity **out);
int ebp_identity_sign(const ebp_identity *identity, int purpose, const uint8_t *message, size_t message_len,
                      const uint8_t *salt, size_t salt_len, uint8_t **signature, size_t *signature_len);
int ebp_identity_verify(const ebp_identity *identity, int purpose, const uint8_t *message, size_t message_len,
                        const uint8_t *salt, size_t salt_len, const uint8_t *signature, size_t signature_len);
/* Attach a signed detail or return a detail only after its proof verifies. */
int ebp_identity_attach_detail(ebp_identity *identity, const uint8_t *path, size_t path_len,
                               const uint8_t *detail, size_t detail_len, int64_t timestamp);
int ebp_identity_get_detail(const ebp_identity *identity, const uint8_t *path, size_t path_len,
                            uint8_t **detail, size_t *detail_len);
/* Current v2 recipient-bound signed and encrypted inner message. */
int ebp_identity_sign_encrypt(const ebp_identity *sender, const ebp_identity *recipient,
                              const uint8_t *message, size_t message_len, uint8_t **ciphertext, size_t *ciphertext_len);
int ebp_identity_decrypt_verify(const ebp_identity *recipient, const ebp_identity *sender,
                                const uint8_t *ciphertext, size_t ciphertext_len,
                                uint8_t **message, size_t *message_len, int *verified);
/* Current-format identity detail proofs. Timestamps and nonces must be safe integers. */
int ebp_detail_proof_create(const ebp_identity *identity, const uint8_t *path, size_t path_len,
                            const uint8_t *detail, size_t detail_len, uint64_t nonce, int64_t timestamp,
                            uint8_t **proof_hex, size_t *proof_len);
int ebp_detail_proof_verify(int signing_algorithm, const uint8_t *signing_key, size_t signing_key_len,
                            const uint8_t *path, size_t path_len, const uint8_t *detail, size_t detail_len,
                            const uint8_t *proof_hex, size_t proof_len, uint64_t *nonce, int64_t *timestamp);
/* Revocation certificates use current signatures and safe integer times/nonces.
 * type: 1 for detail, 2 for identity. Optional reason/target use NULL when absent. */
int ebp_revocation_create(const ebp_identity *identity, int type, uint64_t nonce, int64_t timestamp,
                          const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len,
                          uint8_t **certificate_hex, size_t *certificate_len);
int ebp_revocation_verify(const ebp_identity *identity, const uint8_t *certificate_hex, size_t certificate_len,
                          int expected_type, const uint8_t *expected_target, size_t expected_target_len);
/* Hierarchy certificates require both signatures. Verification does not check expiry or graph policy. */
int ebp_hierarchy_create(const ebp_identity *master, const ebp_identity *child, uint64_t timestamp, uint64_t expiry,
                         const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len,
                         uint8_t **certificate_hex, size_t *certificate_len);
int ebp_hierarchy_verify(const ebp_identity *master, const ebp_identity *child,
                         const uint8_t *certificate_hex, size_t certificate_len);
/* Update identity revocation state atomically after creating a certificate. */
int ebp_identity_revoke(ebp_identity *identity, int type, const uint8_t *target, size_t target_len,
                        const uint8_t *reason, size_t reason_len, int64_t timestamp,
                        uint8_t **certificate_hex, size_t *certificate_len);
int ebp_identity_is_revoked(const ebp_identity *identity);
int ebp_identity_is_detail_revoked(const ebp_identity *identity, const uint8_t *path, size_t path_len);
typedef struct { const char *master_fingerprint; const char *child_fingerprint; } ebp_hierarchy_edge;
int ebp_hierarchy_validate(const ebp_hierarchy_edge *edges, size_t edge_count, const ebp_hierarchy_edge *proposed);
int ebp_hierarchy_expired(uint64_t expiry, uint64_t now);
int ebp_identity_is_private(const ebp_identity *identity);
void ebp_identity_free(ebp_identity *identity);
/* Experimental current identity profiles; private buffers require ebp_secure_free. */
enum ebp_pq_algorithm {
    EBP_ML_DSA_87 = 1, EBP_SLH_DSA_SHA2_256S = 2, EBP_ML_KEM_1024 = 3,
    EBP_ML_DSA_44 = 4, EBP_ML_DSA_65 = 5, EBP_ML_KEM_512 = 6, EBP_ML_KEM_768 = 7,
    EBP_SLH_DSA_SHA2_128F = 8, EBP_SLH_DSA_SHA2_128S = 9,
    EBP_SLH_DSA_SHA2_192F = 10, EBP_SLH_DSA_SHA2_192S = 11,
    EBP_SLH_DSA_SHA2_256F = 12, EBP_SLH_DSA_SHAKE_128F = 13,
    EBP_SLH_DSA_SHAKE_128S = 14, EBP_SLH_DSA_SHAKE_192F = 15,
    EBP_SLH_DSA_SHAKE_192S = 16, EBP_SLH_DSA_SHAKE_256F = 17,
    EBP_SLH_DSA_SHAKE_256S = 18
};
void ebp_secure_free(void *p, size_t len);
int ebp_pq_keygen(int algorithm, const uint8_t *seed, size_t seed_len,
                  uint8_t **pub, size_t *pub_len, uint8_t **priv, size_t *priv_len);
int ebp_pq_public_from_private(int algorithm, const uint8_t *private_key, size_t private_len,
                               uint8_t **public_key, size_t *public_len);
int ebp_pq_sign(int algorithm, const uint8_t *private_key, size_t private_len,
                const uint8_t *message, size_t message_len, uint8_t **signature, size_t *signature_len);
int ebp_pq_verify(int algorithm, const uint8_t *public_key, size_t public_len,
                  const uint8_t *message, size_t message_len, const uint8_t *signature, size_t signature_len);
int ebp_pq_encapsulate_variant(int algorithm, const uint8_t *public_key, size_t public_len,
                               uint8_t **ciphertext, size_t *ciphertext_len, uint8_t secret[32]);
int ebp_pq_decapsulate_variant(int algorithm, const uint8_t *private_key, size_t private_len,
                               const uint8_t *ciphertext, size_t ciphertext_len, uint8_t secret[32]);
int ebp_pq_encapsulate(const uint8_t *public_key, size_t public_len,
                       uint8_t **ciphertext, size_t *ciphertext_len, uint8_t secret[32]);
/* ML-KEM-1024 ciphertext || 12-byte nonce || AES-256-GCM ciphertext and tag. */
int ebp_kem_encrypt_variant(int algorithm, const uint8_t *public_key, size_t public_len,
                            const uint8_t *plaintext, size_t plaintext_len, uint8_t **out, size_t *out_len);
int ebp_kem_decrypt_variant(int algorithm, const uint8_t *private_key, size_t private_len,
                            const uint8_t *ciphertext, size_t ciphertext_len, uint8_t **out, size_t *out_len);
int ebp_kem_encrypt(const uint8_t *public_key, size_t public_len, const uint8_t *plaintext, size_t plaintext_len,
                    uint8_t **out, size_t *out_len);
int ebp_kem_decrypt(const uint8_t *private_key, size_t private_len, const uint8_t *ciphertext, size_t ciphertext_len,
                    uint8_t **out, size_t *out_len);
/* Multi-recipient content encryption and recipient key wrapping primitives. */
int ebp_content_encrypt(const uint8_t key[32], const uint8_t *plaintext, size_t plaintext_len,
                        uint8_t nonce[12], uint8_t **ciphertext, size_t *ciphertext_len);
int ebp_content_decrypt(const uint8_t key[32], const uint8_t nonce[12],
                        const uint8_t *ciphertext, size_t ciphertext_len, uint8_t **out, size_t *out_len);
int ebp_wrap_content_key_variant(int algorithm, const uint8_t *public_key, size_t public_len, const uint8_t key[32],
                                 uint8_t **wrapped, size_t *wrapped_len);
int ebp_unwrap_content_key_variant(int algorithm, const uint8_t *private_key, size_t private_len,
                                   const uint8_t *wrapped, size_t wrapped_len, uint8_t key[32]);
int ebp_wrap_content_key(const uint8_t *public_key, size_t public_len, const uint8_t key[32],
                         uint8_t **wrapped, size_t *wrapped_len);
int ebp_unwrap_content_key(const uint8_t *private_key, size_t private_len,
                           const uint8_t *wrapped, size_t wrapped_len, uint8_t key[32]);
int ebp_pq_decapsulate(const uint8_t *private_key, size_t private_len,
                       const uint8_t *ciphertext, size_t ciphertext_len, uint8_t secret[32]);
#endif
