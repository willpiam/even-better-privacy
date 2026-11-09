#include "ebp_core.h"
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/kdf.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>

static int hkdf_sha512(const uint8_t *key, size_t key_len, const uint8_t *salt, size_t salt_len,
                       const char *info, uint8_t *out, size_t out_len) {
    EVP_PKEY_CTX *ctx = NULL; size_t n = out_len; int ok = 0;
    if ((!key && key_len) || key_len > INT_MAX || salt_len > INT_MAX || strlen(info) > INT_MAX) return 0;
    ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_HKDF, NULL);
    if (ctx && EVP_PKEY_derive_init(ctx) > 0 &&
        EVP_PKEY_CTX_set_hkdf_md(ctx, EVP_sha512()) > 0 &&
        EVP_PKEY_CTX_set1_hkdf_salt(ctx, salt, (int)salt_len) > 0 &&
        EVP_PKEY_CTX_set1_hkdf_key(ctx, key, (int)key_len) > 0 &&
        EVP_PKEY_CTX_add1_hkdf_info(ctx, (const unsigned char *)info, (int)strlen(info)) > 0 &&
        EVP_PKEY_derive(ctx, out, &n) > 0 && n == out_len) ok = 1;
    if (!ok) OPENSSL_cleanse(out, out_len);
    EVP_PKEY_CTX_free(ctx); return ok;
}
int ebp_hd_master(const uint8_t *seed, size_t len, uint8_t node[64]) {
    static const char salt[] = "ebp-hd-v1:master-salt";
    if (!node || (!seed && len)) return 0;
    return hkdf_sha512(seed, len, (const uint8_t *)salt, sizeof(salt)-1, "ebp-hd-v1:master-node", node, 64);
}
int ebp_hd_child(const uint8_t parent[64], uint32_t index, uint32_t depth, uint8_t node[64]) {
    uint8_t input[36]; char info[64]; int ok;
    if (!parent || !node || depth == 0) return 0;
    memcpy(input, parent, 32);
    input[32] = (uint8_t)(index >> 24); input[33] = (uint8_t)(index >> 16);
    input[34] = (uint8_t)(index >> 8); input[35] = (uint8_t)index;
    snprintf(info, sizeof(info), "ebp-hd-v1:child:%u", (unsigned int)depth);
    ok = hkdf_sha512(input, sizeof(input), parent + 32, 32, info, node, 64);
    OPENSSL_cleanse(input, sizeof(input)); return ok;
}
int ebp_hd_identity_seeds(const uint8_t node[64], int sphincs, uint8_t *sign_seed, size_t sign_len, uint8_t kem_seed[64]) {
    const char *info;
    if (!node || !sign_seed || !kem_seed || (sphincs != 0 && sphincs != 1) || sign_len != (sphincs ? 96u : 32u)) return 0;
    info = sphincs ? "ebp-hd-v1:leaf:sphincs:sign-seed" : "ebp-hd-v1:leaf:dilithium:sign-seed";
    if (!hkdf_sha512(node, 32, node + 32, 32, info, sign_seed, sign_len) ||
        !hkdf_sha512(node, 32, node + 32, 32, "ebp-hd-v1:leaf:kyber:kem-seed", kem_seed, 64)) {
        OPENSSL_cleanse(sign_seed, sign_len); OPENSSL_cleanse(kem_seed, 64); return 0;
    }
    return 1;
}
