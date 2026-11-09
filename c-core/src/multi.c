#include "ebp_core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

int ebp_content_encrypt(const uint8_t key[32], const uint8_t *plain, size_t len,
                        uint8_t nonce[12], uint8_t **cipher, size_t *cipher_len) {
    EVP_CIPHER_CTX *ctx = NULL; uint8_t *out = NULL;
    int n = 0, written = 0, ok = 0;
    if (!cipher || !cipher_len || !nonce) return 0;
    *cipher = NULL; *cipher_len = 0;
    if (!key || (!plain && len) || len > INT_MAX || len > SIZE_MAX - 16) return 0;
    out = malloc(len + 16); ctx = EVP_CIPHER_CTX_new();
    if (!out || !ctx || RAND_bytes(nonce, 12) != 1 ||
        EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, nonce) != 1 ||
        (len && EVP_EncryptUpdate(ctx, out, &written, plain, (int)len) != 1) ||
        EVP_EncryptFinal_ex(ctx, out + written, &n) != 1 ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, out + len) != 1) goto done;
    *cipher = out; *cipher_len = len + 16; out = NULL; ok = 1;
done:
    if (!ok) OPENSSL_cleanse(nonce, 12);
    free(out); EVP_CIPHER_CTX_free(ctx); return ok;
}
int ebp_content_decrypt(const uint8_t key[32], const uint8_t nonce[12], const uint8_t *cipher, size_t len,
                        uint8_t **out, size_t *out_len) {
    EVP_CIPHER_CTX *ctx = NULL; uint8_t *plain = NULL;
    size_t plen; int n = 0, written = 0, ok = 0;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!key || !nonce || !cipher || len < 16 || len - 16 > INT_MAX) return 0;
    plen = len - 16; plain = malloc(plen ? plen : 1); ctx = EVP_CIPHER_CTX_new();
    if (!plain || !ctx || EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, key, nonce) != 1 ||
        (plen && EVP_DecryptUpdate(ctx, plain, &written, cipher, (int)plen) != 1) ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, (void *)(cipher + plen)) != 1 ||
        EVP_DecryptFinal_ex(ctx, plain + written, &n) != 1) goto done;
    *out = plain; *out_len = plen; plain = NULL; ok = 1;
done:
    ebp_secure_free(plain, plen); EVP_CIPHER_CTX_free(ctx); return ok;
}
int ebp_wrap_content_key_variant(int alg, const uint8_t *pub, size_t pub_len, const uint8_t key[32],
                         uint8_t **wrapped, size_t *wrapped_len) {
    static const char hex[] = "0123456789abcdef"; uint8_t text[64]; int ok;
    if (!key || !wrapped || !wrapped_len) return 0;
    for (size_t i = 0; i < 32; i++) { text[i*2] = hex[key[i] >> 4]; text[i*2+1] = hex[key[i] & 15]; }
    ok = ebp_kem_encrypt_variant(alg, pub, pub_len, text, sizeof(text), wrapped, wrapped_len);
    OPENSSL_cleanse(text, sizeof(text)); return ok;
}
static int unhex(uint8_t c) {
    if (c >= '0' && c <= '9') return c-'0';
    if (c >= 'a' && c <= 'f') return c-'a'+10;
    if (c >= 'A' && c <= 'F') return c-'A'+10;
    return -1;
}
int ebp_unwrap_content_key_variant(int alg, const uint8_t *priv, size_t priv_len, const uint8_t *wrapped, size_t wrapped_len, uint8_t key[32]) {
    uint8_t *plain = NULL; size_t len = 0; int ok = 0;
    if (!key) return 0;
    OPENSSL_cleanse(key, 32);
    if (!ebp_kem_decrypt_variant(alg, priv, priv_len, wrapped, wrapped_len, &plain, &len) || len != 64) goto done;
    for (size_t i = 0; i < 32; i++) {
        int hi = unhex(plain[i*2]), lo = unhex(plain[i*2+1]);
        if (hi < 0 || lo < 0) goto done;
        key[i] = (uint8_t)((hi << 4) | lo);
    }
    ok = 1;
done:
    if (!ok) OPENSSL_cleanse(key, 32);
    ebp_secure_free(plain, len); return ok;
}

int ebp_wrap_content_key(const uint8_t *pub, size_t pub_len, const uint8_t key[32], uint8_t **wrapped, size_t *wrapped_len) {
    return ebp_wrap_content_key_variant(EBP_ML_KEM_1024,pub,pub_len,key,wrapped,wrapped_len);
}
int ebp_unwrap_content_key(const uint8_t *priv, size_t priv_len, const uint8_t *wrapped, size_t wrapped_len, uint8_t key[32]) {
    return ebp_unwrap_content_key_variant(EBP_ML_KEM_1024,priv,priv_len,wrapped,wrapped_len,key);
}
