#ifndef EBP_CORE_H
#define EBP_CORE_H
#include <stddef.h>
#include <stdint.h>

/* Build bundled dependencies with hidden visibility while exporting the C API. */
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC visibility push(default)
#endif

/* All buffers returned by this API must be freed with ebp_free. */
void ebp_free(void *p);
/* OpenSSL version used by this library; the returned string is not owned. */
const char *ebp_openssl_version(void);
/* Current storage KDF: Argon2id v1.3, 64 MiB, 3 passes, one lane. */
int ebp_derive_storage_key(const uint8_t *password, size_t password_len,
                           const uint8_t salt[16], uint8_t out[32]);
int ebp_sha256(const uint8_t *data, size_t len, uint8_t out[32]);
int ebp_hex_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len);
int ebp_hex_decode(const uint8_t *text, size_t len, uint8_t **out, size_t *out_len);
int ebp_base64_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len);
int ebp_base64_decode(const uint8_t *text, size_t len, uint8_t **out, size_t *out_len);
int ebp_random_hex(size_t byte_len, uint8_t **out, size_t *out_len);
/* RFC 8785 canonical JSON; rejects duplicate keys and invalid Unicode. */
int ebp_json_canonical(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len);
int ebp_json_state_hash(const uint8_t *input, size_t len, uint8_t out[32]);
int ebp_identity_state_from_external(const uint8_t *external_json, size_t external_len,
                                     const uint8_t *details_json, size_t details_len, uint8_t **json, size_t *json_len);
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
enum ebp_verify_status {
    EBP_VERIFY_OK=0, EBP_VERIFY_INVALID_ENCODING=1, EBP_VERIFY_UNSUPPORTED_VERSION=2,
    EBP_VERIFY_MISMATCH=3, EBP_VERIFY_INVALID_NONCE=4, EBP_VERIFY_INVALID_TIMESTAMP=5,
    EBP_VERIFY_MISSING_SIGNATURE=6, EBP_VERIFY_INVALID_SIGNATURE=7, EBP_VERIFY_INVALID_TYPE=8,
    EBP_VERIFY_INVALID_REASON=9, EBP_VERIFY_INVALID_TARGET=10, EBP_VERIFY_MASTER_SIGNATURE=11,
    EBP_VERIFY_CHILD_SIGNATURE=12, EBP_VERIFY_HIERARCHY_SELF=13, EBP_VERIFY_HIERARCHY_DUPLICATE=14,
    EBP_VERIFY_HIERARCHY_LOOP=15, EBP_VERIFY_HIERARCHY_INVALID_EDGE=16
};
const char *ebp_verify_status_message(int status);
int ebp_message_envelope(int purpose, const uint8_t *message, size_t message_len,
                         const uint8_t *salt, size_t salt_len, uint8_t **out, size_t *out_len);
int ebp_recipient_envelope(const uint8_t *recipient, size_t recipient_len,
                           const uint8_t *message, size_t message_len,
                           const uint8_t *salt, size_t salt_len, uint8_t **out, size_t *out_len);
/* Build the v4 recipient-set and attachment-manifest signature envelope. */
int ebp_multi_normalize(const uint8_t *recipients_json, size_t recipients_len,
                        const uint8_t *manifest_json, size_t manifest_len,
                        uint8_t **out, size_t *out_len);
int ebp_multi_envelope(const uint8_t *message, size_t message_len,
                       const uint8_t *recipients_json, size_t recipients_len,
                       const uint8_t *manifest_json, size_t manifest_len,
                       const uint8_t *salt, size_t salt_len,
                       uint8_t **out, size_t *out_len);
/* Output must have space for 65 bytes (64 characters and a terminator). */
int ebp_identity_fingerprint(int sphincs, const uint8_t *signing_key, size_t signing_key_len,
                             const uint8_t *encryption_key, size_t encryption_key_len, char out[65]);
int ebp_fingerprint_decode(const char *fingerprint, int *sphincs, uint8_t root[32]);
int ebp_short_fingerprint(const uint8_t *fingerprint, size_t len, uint8_t **out, size_t *out_len);
/* Current EBP mnemonic format. Returned entropy and phrases are secret buffers. */
int ebp_entropy_to_mnemonic(const uint8_t *entropy, size_t entropy_len, uint8_t **phrase, size_t *phrase_len);
int ebp_mnemonic_to_entropy(const uint8_t *phrase, size_t phrase_len, uint8_t **entropy, size_t *entropy_len);
int ebp_mnemonic_to_seed(const uint8_t *phrase, size_t phrase_len,
                         const uint8_t *passphrase, size_t passphrase_len, uint8_t out[64]);
int ebp_identity_fingerprint_from_leaves(int sphincs, const uint8_t signing_leaf[32],
                                          const uint8_t encryption_leaf[32], char out[65]);
/* HD nodes are 32-byte key || 32-byte chain code. */
int ebp_hd_master(const uint8_t *seed, size_t seed_len, uint8_t node[64]);
int ebp_hd_child(const uint8_t parent[64], uint32_t child_index, uint32_t child_depth, uint8_t node[64]);
typedef struct {
    uint32_t indices[5];
    int hardened[5];
    size_t normalized_offset, normalized_len;
} ebp_hd_path;
int ebp_hd_parse_path(const uint8_t *path, size_t path_len, ebp_hd_path *parsed);
int ebp_hd_format_path(int sphincs, uint32_t account, int change, uint32_t index, uint8_t **path, size_t *path_len);
int ebp_hd_provenance(const uint8_t *path, size_t path_len, uint8_t **json, size_t *json_len);
int ebp_file_sign_message(const uint8_t *file_hash, size_t file_hash_len, const uint8_t *salt, size_t salt_len,
                          const uint8_t *context, size_t context_len, uint8_t **out, size_t *out_len);
/* Derive any TypeScript-supported five-segment path; profile is 0 (dilithium) or 1 (sphincs). */
int ebp_hd_derive_path(const uint8_t *seed, size_t seed_len, const uint8_t *path, size_t path_len,
                       uint8_t node[64], int *profile);
int ebp_hd_identity_seeds(const uint8_t node[64], int sphincs,
                          uint8_t *sign_seed, size_t sign_seed_len, uint8_t kem_seed[64]);
/* File envelopes operate on bytes; paths and file access remain with the caller. */
int ebp_file_envelope_create(const uint8_t *file, size_t file_len, const uint8_t *name, size_t name_len,
                             const uint8_t *mime, size_t mime_len, uint8_t **json, size_t *json_len);
int ebp_file_envelope_parse(const uint8_t *json, size_t json_len, uint8_t **file, size_t *file_len,
                            uint8_t **name, size_t *name_len, uint8_t **mime, size_t *mime_len);
int ebp_email_attachment_create(const uint8_t *file, size_t file_len, const uint8_t *name, size_t name_len,
                                const uint8_t *mime, size_t mime_len, const uint8_t *attachment_id, size_t attachment_id_len,
                                const uint8_t *body_hash, size_t body_hash_len, uint8_t **json, size_t *json_len);
int ebp_email_attachment_parse(const uint8_t *json, size_t json_len, uint8_t **file, size_t *file_len,
                               uint8_t **metadata_json, size_t *metadata_len);
int ebp_encrypted_email_attachment_parse(const uint8_t *json, size_t json_len, uint8_t **out, size_t *out_len);
/* Parse and armor current-version payload JSON. Parsing checks the type and version,
 * but does not authenticate signatures, recipients, or payload fields. */
int ebp_payload_parse(const uint8_t *input, size_t input_len, uint8_t **json, size_t *json_len);
int ebp_payload_armor(const uint8_t *json, size_t json_len, uint8_t **armored, size_t *armored_len);
/* Build one current message or file payload from a JSON object of fields. */
int ebp_payload_build(const char *type, const uint8_t *fields, size_t fields_len, uint8_t **json, size_t *json_len);
int ebp_multi_recipient_entries_parse(const uint8_t *json, size_t json_len, uint8_t **out, size_t *out_len);
/* An identity owns its key material; private objects must be released with ebp_identity_free. */
typedef struct ebp_identity ebp_identity;
int ebp_identity_create(int sphincs, ebp_identity **out);
int ebp_identity_create_variants(int signing_algorithm, int kem_algorithm,
                                 const uint8_t *signing_seed, size_t signing_seed_len,
                                 const uint8_t *kem_seed, size_t kem_seed_len, ebp_identity **out);
int ebp_identity_from_hd_seed(const uint8_t *seed, size_t seed_len, int sphincs,
                              uint32_t account, int change, uint32_t index, ebp_identity **out);
int ebp_identity_from_hd_node(const uint8_t node[64], const uint8_t *path, size_t path_len, ebp_identity **out);
int ebp_identity_public_json(const ebp_identity *identity, uint8_t **json, size_t *json_len);
int ebp_identity_public_export(const ebp_identity *identity, int include_signing_key, int include_encryption_key,
                               int include_details, uint8_t **json, size_t *json_len);
/* Imports a public-data or current public-export object with at least one public key. */
int ebp_identity_from_public_json(const uint8_t *json, size_t json_len, ebp_identity **out);
int ebp_identity_from_embedded_json(const uint8_t *json, size_t json_len, const char *expected_fingerprint, ebp_identity **out);
int ebp_identity_store(const ebp_identity *identity, const uint8_t *password, size_t password_len,
                       uint8_t **json, size_t *json_len);
int ebp_identity_store_with_key(const ebp_identity *identity, const uint8_t key[32], const uint8_t salt[16],
                                uint8_t **json, size_t *json_len);
/* unlock=0 loads only public metadata; unlock=1 requires a password. */
int ebp_identity_load(const uint8_t *json, size_t json_len, const uint8_t *password, size_t password_len,
                      int unlock, ebp_identity **out);
int ebp_identity_load_with_key(const uint8_t *json, size_t json_len, const uint8_t key[32], ebp_identity **out);
int ebp_identity_sign(const ebp_identity *identity, int purpose, const uint8_t *message, size_t message_len,
                      const uint8_t *salt, size_t salt_len, uint8_t **signature, size_t *signature_len);
int ebp_identity_verify(const ebp_identity *identity, int purpose, const uint8_t *message, size_t message_len,
                        const uint8_t *salt, size_t salt_len, const uint8_t *signature, size_t signature_len);
/* Attach a signed detail or return a detail only after its proof verifies. */
int ebp_identity_attach_detail(ebp_identity *identity, const uint8_t *path, size_t path_len,
                               const uint8_t *detail, size_t detail_len, int64_t timestamp);
int ebp_identity_get_detail(const ebp_identity *identity, const uint8_t *path, size_t path_len,
                            uint8_t **detail, size_t *detail_len);
/* Structural checks only: validates detail contents and nonce/timestamp order,
 * but does not verify signatures. Use ebp_identity_get_detail for that. */
int ebp_identity_verify_details(const ebp_identity *identity);
/* V4 multi-recipient signatures over JSON arrays of recipients and manifest entries. */
int ebp_identity_sign_multi(const ebp_identity *identity, const uint8_t *message, size_t message_len,
                            const uint8_t *recipients_json, size_t recipients_len, const uint8_t *manifest_json, size_t manifest_len,
                            const uint8_t *salt, size_t salt_len, uint8_t **signature, size_t *signature_len);
int ebp_identity_verify_multi(const ebp_identity *identity, const uint8_t *message, size_t message_len,
                              const uint8_t *recipients_json, size_t recipients_len, const uint8_t *manifest_json, size_t manifest_len,
                              const uint8_t *salt, size_t salt_len, const uint8_t *signature, size_t signature_len);
/* Complete current v4 workflow. content_key is NULL to generate one, or points
 * to 32 caller-supplied bytes. JSON results include the secret content key;
 * release returned buffers with ebp_secure_free. */
int ebp_identity_sign_encrypt_many(const ebp_identity *sender, const ebp_identity *const *recipients, size_t recipient_count,
                                   const uint8_t *message, size_t message_len, const uint8_t *manifest_json, size_t manifest_len,
                                   const uint8_t *content_key, uint8_t **result_json, size_t *result_len);
int ebp_identity_decrypt_verify_many(const ebp_identity *recipient, const ebp_identity *sender,
                                     const uint8_t *payload_json, size_t payload_len,
                                     uint8_t **result_json, size_t *result_len);
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
int ebp_detail_proof_verify_ex(int signing_algorithm, const uint8_t *signing_key, size_t signing_key_len,
                               const uint8_t *path, size_t path_len, const uint8_t *detail, size_t detail_len,
                               const uint8_t *proof_hex, size_t proof_len, uint64_t *nonce, int64_t *timestamp);
/* Revocation certificates use current signatures and safe integer times/nonces.
 * type: 1 for detail, 2 for identity. Optional reason/target use NULL when absent. */
int ebp_revocation_create(const ebp_identity *identity, int type, uint64_t nonce, int64_t timestamp,
                          const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len,
                          uint8_t **certificate_hex, size_t *certificate_len);
int ebp_revocation_verify(const ebp_identity *identity, const uint8_t *certificate_hex, size_t certificate_len,
                          int expected_type, const uint8_t *expected_target, size_t expected_target_len);
int ebp_revocation_verify_ex(const ebp_identity *identity, const uint8_t *certificate_hex, size_t certificate_len,
                             int expected_type, const uint8_t *expected_target, size_t expected_target_len);
int ebp_revocation_unsigned(int type, const char *fingerprint, uint64_t nonce, int64_t timestamp,
                            const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len,
                            uint8_t **json, size_t *json_len);
int ebp_revocation_signature_payload(const uint8_t *json, size_t json_len, uint8_t **payload, size_t *payload_len);
int ebp_revocation_encode(const uint8_t *json, size_t json_len, uint8_t **hex, size_t *hex_len);
int ebp_revocation_decode(const uint8_t *hex, size_t hex_len, uint8_t **json, size_t *json_len);
/* Hierarchy certificates require both signatures. Verification does not check expiry or graph policy. */
int ebp_hierarchy_create(const ebp_identity *master, const ebp_identity *child, uint64_t timestamp, uint64_t expiry,
                         const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len,
                         uint8_t **certificate_hex, size_t *certificate_len);
int ebp_hierarchy_verify(const ebp_identity *master, const ebp_identity *child,
                         const uint8_t *certificate_hex, size_t certificate_len);
int ebp_hierarchy_verify_ex(const ebp_identity *master, const ebp_identity *child,
                            const uint8_t *certificate_hex, size_t certificate_len);
/* Staged hierarchy construction: JSON records can be signed by each holder independently. */
int ebp_hierarchy_unsigned(const char *master_fingerprint, const char *child_fingerprint, uint64_t timestamp, uint64_t expiry,
                           const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len,
                           uint8_t **json, size_t *json_len);
int ebp_hierarchy_signature_payload(const uint8_t *json, size_t json_len, uint8_t **payload, size_t *payload_len);
int ebp_hierarchy_sign_part(const ebp_identity *signer, int is_child, const uint8_t *json, size_t json_len,
                            uint8_t **signed_json, size_t *signed_json_len);
int ebp_hierarchy_encode(const uint8_t *json, size_t json_len, uint8_t **hex, size_t *hex_len);
int ebp_hierarchy_decode(const uint8_t *hex, size_t hex_len, uint8_t **json, size_t *json_len);
int ebp_hierarchy_decode_draft(const uint8_t *hex, size_t hex_len, uint8_t **json, size_t *json_len);
/* Update identity revocation state atomically after creating a certificate. */
int ebp_identity_revoke(ebp_identity *identity, int type, const uint8_t *target, size_t target_len,
                        const uint8_t *reason, size_t reason_len, int64_t timestamp,
                        uint8_t **certificate_hex, size_t *certificate_len);
int ebp_identity_is_revoked(const ebp_identity *identity);
int ebp_identity_is_detail_revoked(const ebp_identity *identity, const uint8_t *path, size_t path_len);
/* Decode a stored revocation certificate without verifying its signature.
 * type is 1 for detail and 2 for identity. */
int ebp_identity_revocation_json(const ebp_identity *identity, int type, const uint8_t *path, size_t path_len,
                                 uint8_t **json, size_t *json_len);
typedef struct { const char *master_fingerprint; const char *child_fingerprint; } ebp_hierarchy_edge;
int ebp_hierarchy_validate(const ebp_hierarchy_edge *edges, size_t edge_count, const ebp_hierarchy_edge *proposed);
int ebp_hierarchy_validate_ex(const ebp_hierarchy_edge *edges, size_t edge_count, const ebp_hierarchy_edge *proposed);
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
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC visibility pop
#endif
#endif
