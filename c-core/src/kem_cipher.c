#include "ebp_core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

#define KEM_CIPHERTEXT_LEN 1568u
#define NONCE_LEN 12u
#define TAG_LEN 16u
#define OVERHEAD (KEM_CIPHERTEXT_LEN + NONCE_LEN + TAG_LEN)
int ebp_kem_encrypt(const uint8_t *pub, size_t pub_len, const uint8_t *plain, size_t plain_len,
                    uint8_t **out, size_t *out_len) {
    uint8_t secret[32] = {0}, *kem = NULL, *buf = NULL;
    size_t kem_len = 0; int n = 0, written = 0, ok = 0;
    EVP_CIPHER_CTX *ctx = NULL;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!pub || (!plain && plain_len) || plain_len > INT_MAX || plain_len > SIZE_MAX - OVERHEAD) return 0;
    if (!ebp_pq_encapsulate(pub, pub_len, &kem, &kem_len, secret) || kem_len != KEM_CIPHERTEXT_LEN) goto done;
    buf = malloc(OVERHEAD + plain_len); ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx) goto done;
    memcpy(buf, kem, kem_len);
    if (RAND_bytes(buf + KEM_CIPHERTEXT_LEN, NONCE_LEN) != 1 ||
        EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, secret, buf + KEM_CIPHERTEXT_LEN) != 1) goto done;
    if (plain_len && EVP_EncryptUpdate(ctx, buf + KEM_CIPHERTEXT_LEN + NONCE_LEN, &written, plain, (int)plain_len) != 1) goto done;
    if (EVP_EncryptFinal_ex(ctx, buf + KEM_CIPHERTEXT_LEN + NONCE_LEN + written, &n) != 1 ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, TAG_LEN, buf + KEM_CIPHERTEXT_LEN + NONCE_LEN + plain_len) != 1) goto done;
    *out = buf; *out_len = OVERHEAD + plain_len; buf = NULL; ok = 1;
done:
    OPENSSL_cleanse(secret, sizeof(secret)); free(kem); free(buf); EVP_CIPHER_CTX_free(ctx); return ok;
}
int ebp_kem_decrypt(const uint8_t *priv, size_t priv_len, const uint8_t *cipher, size_t cipher_len,
                    uint8_t **out, size_t *out_len) {
    uint8_t secret[32] = {0}, *buf = NULL; EVP_CIPHER_CTX *ctx = NULL;
    size_t plain_len; int n = 0, written = 0, ok = 0;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!priv || !cipher || cipher_len < OVERHEAD || cipher_len - OVERHEAD > INT_MAX) return 0;
    plain_len = cipher_len - OVERHEAD;
    if (!ebp_pq_decapsulate(priv, priv_len, cipher, KEM_CIPHERTEXT_LEN, secret)) goto done;
    buf = malloc(plain_len ? plain_len : 1); ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx || EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, secret, cipher + KEM_CIPHERTEXT_LEN) != 1) goto done;
    if (plain_len && EVP_DecryptUpdate(ctx, buf, &written, cipher + KEM_CIPHERTEXT_LEN + NONCE_LEN, (int)plain_len) != 1) goto done;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, TAG_LEN, (void *)(cipher + cipher_len - TAG_LEN)) != 1 ||
        EVP_DecryptFinal_ex(ctx, buf + written, &n) != 1) goto done;
    *out = buf; *out_len = plain_len; buf = NULL; ok = 1;
done:
    OPENSSL_cleanse(secret, sizeof(secret)); ebp_secure_free(buf, plain_len); EVP_CIPHER_CTX_free(ctx); return ok;
}
