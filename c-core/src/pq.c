#include "ebp_core.h"
#include <stdlib.h>
#include <openssl/core_names.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/params.h>

void ebp_secure_free(void *p, size_t len) {
    if (p) { OPENSSL_cleanse(p, len); free(p); }
}
typedef struct { const char *name; size_t seed_len; int kem; } pq_info;
static const pq_info *algorithm_info(int alg) {
    static const pq_info table[] = {
        {NULL,0,0}, {"ML-DSA-87",32,0}, {"SLH-DSA-SHA2-256s",96,0}, {"ML-KEM-1024",64,1},
        {"ML-DSA-44",32,0}, {"ML-DSA-65",32,0}, {"ML-KEM-512",64,1}, {"ML-KEM-768",64,1},
        {"SLH-DSA-SHA2-128f",48,0}, {"SLH-DSA-SHA2-128s",48,0},
        {"SLH-DSA-SHA2-192f",72,0}, {"SLH-DSA-SHA2-192s",72,0},
        {"SLH-DSA-SHA2-256f",96,0}, {"SLH-DSA-SHAKE-128f",48,0},
        {"SLH-DSA-SHAKE-128s",48,0}, {"SLH-DSA-SHAKE-192f",72,0},
        {"SLH-DSA-SHAKE-192s",72,0}, {"SLH-DSA-SHAKE-256f",96,0},
        {"SLH-DSA-SHAKE-256s",96,0}
    };
    return alg > 0 && (size_t)alg < sizeof(table)/sizeof(table[0]) ? &table[alg] : NULL;
}
static const char *alg_name(int alg) {
    const pq_info *info = algorithm_info(alg);
    return info ? info->name : NULL;
}
static EVP_PKEY *import_key(int alg, const uint8_t *raw, size_t len, int private_key) {
    EVP_PKEY_CTX *ctx = NULL;
    EVP_PKEY *key = NULL;
    const char *name = alg_name(alg);
    OSSL_PARAM params[2];
    if (!name || !raw || !len) return NULL;
    params[0] = OSSL_PARAM_construct_octet_string(private_key ? OSSL_PKEY_PARAM_PRIV_KEY : OSSL_PKEY_PARAM_PUB_KEY, (void *)raw, len);
    params[1] = OSSL_PARAM_construct_end();
    ctx = EVP_PKEY_CTX_new_from_name(NULL, name, NULL);
    if (!ctx || EVP_PKEY_fromdata_init(ctx) <= 0 ||
        EVP_PKEY_fromdata(ctx, &key, private_key ? EVP_PKEY_KEYPAIR : EVP_PKEY_PUBLIC_KEY, params) <= 0) {
        EVP_PKEY_free(key); key = NULL;
    }
    EVP_PKEY_CTX_free(ctx);
    return key;
}
int ebp_pq_keygen(int alg, const uint8_t *seed, size_t seed_len,
                  uint8_t **pub, size_t *pub_len, uint8_t **priv, size_t *priv_len) {
    EVP_PKEY_CTX *ctx = NULL;
    EVP_PKEY *key = NULL;
    uint8_t *p = NULL, *s = NULL;
    size_t pn = 0, sn = 0;
    int ok = 0;
    const pq_info *info = algorithm_info(alg);
    const char *name = info ? info->name : NULL;
    OSSL_PARAM params[2];
    if (!pub || !priv || !pub_len || !priv_len) return 0;
    *pub = NULL; *priv = NULL; *pub_len = 0; *priv_len = 0;
    if (!name || (!seed && seed_len) || (seed && seed_len != info->seed_len)) return 0;
    ctx = EVP_PKEY_CTX_new_from_name(NULL, name, NULL);
    if (!ctx || EVP_PKEY_keygen_init(ctx) <= 0) goto done;
    if (seed) {
        params[0] = OSSL_PARAM_construct_octet_string("seed", (void *)seed, seed_len);
        params[1] = OSSL_PARAM_construct_end();
        if (EVP_PKEY_CTX_set_params(ctx, params) <= 0) goto done;
    }
    if (EVP_PKEY_generate(ctx, &key) <= 0 ||
        EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PUB_KEY, NULL, 0, &pn) <= 0 ||
        EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PRIV_KEY, NULL, 0, &sn) <= 0) goto done;
    p = malloc(pn); s = malloc(sn);
    if (!p || !s || EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PUB_KEY, p, pn, &pn) <= 0 ||
        EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PRIV_KEY, s, sn, &sn) <= 0) goto done;
    *pub = p; *pub_len = pn; *priv = s; *priv_len = sn; p = s = NULL; ok = 1;
done:
    free(p); ebp_secure_free(s, sn); EVP_PKEY_free(key); EVP_PKEY_CTX_free(ctx); return ok;
}
int ebp_pq_public_from_private(int alg, const uint8_t *priv, size_t priv_len,
                               uint8_t **pub, size_t *pub_len) {
    EVP_PKEY *key = NULL; uint8_t *buf = NULL; size_t len = 0; int ok = 0;
    if (!pub || !pub_len) return 0;
    *pub = NULL; *pub_len = 0;
    key = import_key(alg, priv, priv_len, 1);
    if (!key || EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PUB_KEY, NULL, 0, &len) <= 0) goto done;
    buf = malloc(len);
    if (!buf || EVP_PKEY_get_octet_string_param(key, OSSL_PKEY_PARAM_PUB_KEY, buf, len, &len) <= 0) goto done;
    *pub = buf; *pub_len = len; buf = NULL; ok = 1;
done:
    free(buf); EVP_PKEY_free(key); return ok;
}
int ebp_pq_sign(int alg, const uint8_t *priv, size_t priv_len, const uint8_t *msg, size_t msg_len,
                uint8_t **sig, size_t *sig_len) {
    EVP_PKEY *key = NULL; EVP_MD_CTX *ctx = NULL; uint8_t *out = NULL; size_t n = 0; int ok = 0;
    if (!sig || !sig_len) return 0;
    *sig = NULL; *sig_len = 0;
    if (!algorithm_info(alg) || algorithm_info(alg)->kem || (!msg && msg_len)) return 0;
    key = import_key(alg, priv, priv_len, 1); ctx = EVP_MD_CTX_new();
    if (!key || !ctx || EVP_DigestSignInit(ctx, NULL, NULL, NULL, key) <= 0 ||
        EVP_DigestSign(ctx, NULL, &n, msg, msg_len) <= 0) goto done;
    out = malloc(n);
    if (!out || EVP_DigestSign(ctx, out, &n, msg, msg_len) <= 0) goto done;
    *sig = out; *sig_len = n; out = NULL; ok = 1;
done:
    free(out); EVP_MD_CTX_free(ctx); EVP_PKEY_free(key); return ok;
}
int ebp_pq_verify(int alg, const uint8_t *pub, size_t pub_len, const uint8_t *msg, size_t msg_len,
                  const uint8_t *sig, size_t sig_len) {
    EVP_PKEY *key; EVP_MD_CTX *ctx; int ok = 0;
    if (!algorithm_info(alg) || algorithm_info(alg)->kem || (!msg && msg_len) || !sig) return 0;
    key = import_key(alg, pub, pub_len, 0); ctx = EVP_MD_CTX_new();
    if (key && ctx && EVP_DigestVerifyInit(ctx, NULL, NULL, NULL, key) > 0 &&
        EVP_DigestVerify(ctx, sig, sig_len, msg, msg_len) == 1) ok = 1;
    EVP_MD_CTX_free(ctx); EVP_PKEY_free(key); return ok;
}
int ebp_pq_encapsulate_variant(int alg, const uint8_t *pub, size_t pub_len, uint8_t **ct, size_t *ct_len, uint8_t secret[32]) {
    EVP_PKEY *key = NULL; EVP_PKEY_CTX *ctx = NULL; uint8_t *out = NULL;
    size_t n = 0, sn = 0; int ok = 0;
    if (!ct || !ct_len || !secret) return 0;
    *ct = NULL; *ct_len = 0; OPENSSL_cleanse(secret, 32);
    if (!algorithm_info(alg) || !algorithm_info(alg)->kem) return 0;
    key = import_key(alg, pub, pub_len, 0);
    if (!key) goto done;
    ctx = EVP_PKEY_CTX_new_from_pkey(NULL, key, NULL);
    if (!ctx || EVP_PKEY_encapsulate_init(ctx, NULL) <= 0 ||
        EVP_PKEY_encapsulate(ctx, NULL, &n, NULL, &sn) <= 0 || sn != 32) goto done;
    out = malloc(n);
    if (!out || EVP_PKEY_encapsulate(ctx, out, &n, secret, &sn) <= 0 || sn != 32) goto done;
    *ct = out; *ct_len = n; out = NULL; ok = 1;
done:
    if (!ok) OPENSSL_cleanse(secret, 32);
    free(out); EVP_PKEY_CTX_free(ctx); EVP_PKEY_free(key); return ok;
}
int ebp_pq_decapsulate_variant(int alg, const uint8_t *priv, size_t priv_len, const uint8_t *ct, size_t ct_len, uint8_t secret[32]) {
    EVP_PKEY *key = NULL; EVP_PKEY_CTX *ctx = NULL; size_t n = 32; int ok = 0;
    if (!ct || !secret) return 0;
    OPENSSL_cleanse(secret, 32);
    if (!algorithm_info(alg) || !algorithm_info(alg)->kem) return 0;
    key = import_key(alg, priv, priv_len, 1);
    if (!key) goto done;
    ctx = EVP_PKEY_CTX_new_from_pkey(NULL, key, NULL);
    if (ctx && EVP_PKEY_decapsulate_init(ctx, NULL) > 0 &&
        EVP_PKEY_decapsulate(ctx, secret, &n, ct, ct_len) > 0 && n == 32) ok = 1;
done:
    if (!ok) OPENSSL_cleanse(secret, 32);
    EVP_PKEY_CTX_free(ctx); EVP_PKEY_free(key); return ok;
}

int ebp_pq_encapsulate(const uint8_t *pub, size_t pub_len, uint8_t **ct, size_t *ct_len, uint8_t secret[32]) {
    return ebp_pq_encapsulate_variant(EBP_ML_KEM_1024,pub,pub_len,ct,ct_len,secret);
}
int ebp_pq_decapsulate(const uint8_t *priv, size_t priv_len, const uint8_t *ct, size_t ct_len, uint8_t secret[32]) {
    return ebp_pq_decapsulate_variant(EBP_ML_KEM_1024,priv,priv_len,ct,ct_len,secret);
}
