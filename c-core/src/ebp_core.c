#include "ebp_core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <argon2.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

void ebp_free(void *p) { free(p); }
int ebp_derive_storage_key(const uint8_t *password, size_t password_len,
                           const uint8_t salt[16], uint8_t out[32]) {
    int rc;
    if ((!password && password_len) || !salt || !out) return 0;
    rc = argon2id_hash_raw(3, 65536, 1, password, password_len, salt, 16, out, 32);
    if (rc != ARGON2_OK) { OPENSSL_cleanse(out, 32); return 0; }
    return 1;
}
int ebp_sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
    unsigned int n = 0;
    if ((!data && len) || !out) return 0;
    return EVP_Digest(data, len, out, &n, EVP_sha256(), NULL) == 1 && n == 32;
}
int ebp_aes_encrypt(const uint8_t key[32], const uint8_t salt[16],
                    const uint8_t *plain, size_t len, const uint8_t *aad, size_t aad_len,
                    uint8_t **out, size_t *out_len) {
    EVP_CIPHER_CTX *ctx = NULL;
    uint8_t *buf = NULL;
    int n = 0, written = 0, ok = 0;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!key || !salt || (!plain && len) || (!aad && aad_len) || len > INT_MAX || aad_len > INT_MAX || len > SIZE_MAX - 45) return 0;
    buf = malloc(len + 45);
    ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx) goto end;
    buf[0] = 4; memcpy(buf + 1, salt, 16);
    if (RAND_bytes(buf + 17, 12) != 1 ||
        EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, buf + 17) != 1 ||
        (aad_len && EVP_EncryptUpdate(ctx, NULL, &n, aad, (int)aad_len) != 1) ||
        (len && EVP_EncryptUpdate(ctx, buf + 29, &written, plain, (int)len) != 1) ||
        EVP_EncryptFinal_ex(ctx, buf + 29 + written, &n) != 1 ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, buf + 29 + len) != 1) goto end;
    *out = buf; *out_len = len + 45; buf = NULL; ok = 1;
end:
    EVP_CIPHER_CTX_free(ctx); free(buf); return ok;
}
int ebp_aes_decrypt(const uint8_t key[32], const uint8_t *blob, size_t len,
                    const uint8_t *aad, size_t aad_len, uint8_t **out, size_t *out_len) {
    EVP_CIPHER_CTX *ctx = NULL;
    uint8_t *buf = NULL;
    size_t clen;
    int n = 0, written = 0, ok = 0;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!key || !blob || (!aad && aad_len) || len < 45 || blob[0] != 4 || aad_len > INT_MAX) return 0;
    clen = len - 45;
    if (clen > INT_MAX) return 0;
    buf = malloc(clen ? clen : 1); ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx) goto end;
    if (EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, blob + 17) != 1 ||
        (aad_len && EVP_DecryptUpdate(ctx, NULL, &n, aad, (int)aad_len) != 1) ||
        (clen && EVP_DecryptUpdate(ctx, buf, &written, blob + 29, (int)clen) != 1) ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, (void *)(blob + len - 16)) != 1 ||
        EVP_DecryptFinal_ex(ctx, buf + written, &n) != 1) goto end;
    *out = buf; *out_len = clen; buf = NULL; ok = 1;
end:
    EVP_CIPHER_CTX_free(ctx);
    if (buf) { OPENSSL_cleanse(buf, clen); free(buf); }
    return ok;
}
