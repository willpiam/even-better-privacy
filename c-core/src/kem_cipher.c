#include "ebp_core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

#define NONCE_LEN 12u
#define TAG_LEN 16u
static size_t kem_ciphertext_len(int alg) {
    if (alg == EBP_ML_KEM_512) return 768;
    if (alg == EBP_ML_KEM_768) return 1088;
    if (alg == EBP_ML_KEM_1024) return 1568;
    return 0;
}
int ebp_kem_encrypt_variant(int alg, const uint8_t *pub, size_t pub_len, const uint8_t *plain, size_t plain_len,
                    uint8_t **out, size_t *out_len) {
    uint8_t secret[32] = {0}, *kem = NULL, *buf = NULL;
    size_t kem_len = 0, klen = kem_ciphertext_len(alg), overhead = klen + NONCE_LEN + TAG_LEN;
    int n = 0, written = 0, ok = 0;
    EVP_CIPHER_CTX *ctx = NULL;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!klen || !pub || (!plain && plain_len) || plain_len > INT_MAX || plain_len > SIZE_MAX - overhead) return 0;
    if (!ebp_pq_encapsulate_variant(alg, pub, pub_len, &kem, &kem_len, secret) || kem_len != klen) goto done;
    buf = malloc(overhead + plain_len); ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx) goto done;
    memcpy(buf, kem, kem_len);
    if (RAND_bytes(buf + klen, NONCE_LEN) != 1 ||
        EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, secret, buf + klen) != 1) goto done;
    if (plain_len && EVP_EncryptUpdate(ctx, buf + klen + NONCE_LEN, &written, plain, (int)plain_len) != 1) goto done;
    if (EVP_EncryptFinal_ex(ctx, buf + klen + NONCE_LEN + written, &n) != 1 ||
        EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, TAG_LEN, buf + klen + NONCE_LEN + plain_len) != 1) goto done;
    *out = buf; *out_len = overhead + plain_len; buf = NULL; ok = 1;
done:
    OPENSSL_cleanse(secret, sizeof(secret)); free(kem); free(buf); EVP_CIPHER_CTX_free(ctx); return ok;
}
int ebp_kem_decrypt_variant(int alg, const uint8_t *priv, size_t priv_len, const uint8_t *cipher, size_t cipher_len,
                    uint8_t **out, size_t *out_len) {
    uint8_t secret[32] = {0}, *buf = NULL; EVP_CIPHER_CTX *ctx = NULL;
    size_t plain_len, klen = kem_ciphertext_len(alg), overhead = klen + NONCE_LEN + TAG_LEN;
    int n = 0, written = 0, ok = 0;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if (!klen || !priv || !cipher || cipher_len < overhead || cipher_len - overhead > INT_MAX) return 0;
    plain_len = cipher_len - overhead;
    if (!ebp_pq_decapsulate_variant(alg, priv, priv_len, cipher, klen, secret)) goto done;
    buf = malloc(plain_len ? plain_len : 1); ctx = EVP_CIPHER_CTX_new();
    if (!buf || !ctx || EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), NULL, secret, cipher + klen) != 1) goto done;
    if (plain_len && EVP_DecryptUpdate(ctx, buf, &written, cipher + klen + NONCE_LEN, (int)plain_len) != 1) goto done;
    if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, TAG_LEN, (void *)(cipher + cipher_len - TAG_LEN)) != 1 ||
        EVP_DecryptFinal_ex(ctx, buf + written, &n) != 1) goto done;
    *out = buf; *out_len = plain_len; buf = NULL; ok = 1;
done:
    OPENSSL_cleanse(secret, sizeof(secret)); ebp_secure_free(buf, plain_len); EVP_CIPHER_CTX_free(ctx); return ok;
}

int ebp_kem_encrypt(const uint8_t *pub, size_t pub_len, const uint8_t *plain, size_t plain_len,
                    uint8_t **out, size_t *out_len) {
    return ebp_kem_encrypt_variant(EBP_ML_KEM_1024,pub,pub_len,plain,plain_len,out,out_len);
}
int ebp_kem_decrypt(const uint8_t *priv, size_t priv_len, const uint8_t *cipher, size_t cipher_len,
                    uint8_t **out, size_t *out_len) {
    return ebp_kem_decrypt_variant(EBP_ML_KEM_1024,priv,priv_len,cipher,cipher_len,out,out_len);
}
