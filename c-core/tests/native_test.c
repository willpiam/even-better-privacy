#include "ebp_core.h"
#include <assert.h>
#include <stdint.h>
#include <string.h>

int main(void) {
    uint8_t key[32] = {0}, node[64] = {0}, salt[16] = {0}, *cipher = NULL, *plain = NULL, *envelope = NULL;
    size_t clen = 0, plen = 0, elen = 0;
    const uint8_t msg[] = {0, 1, 2, 0, 255};
    assert(ebp_aes_encrypt(key, salt, msg, sizeof(msg), NULL, 0, &cipher, &clen));
    assert(ebp_aes_decrypt(key, cipher, clen, NULL, 0, &plain, &plen));
    assert(plen == sizeof(msg) && memcmp(plain, msg, plen) == 0);
    ebp_secure_free(plain, plen); plain = NULL;
    cipher[clen - 1] ^= 1;
    assert(!ebp_aes_decrypt(key, cipher, clen, NULL, 0, &plain, &plen));
    assert(plain == NULL && plen == 0);
    ebp_free(cipher);
    assert(!ebp_aes_decrypt(key, msg, sizeof(msg), NULL, 0, &plain, &plen));
    assert(!ebp_message_envelope(0, msg, sizeof(msg), NULL, 0, &envelope, &elen));
    assert(!envelope && !elen);
    assert(ebp_message_envelope(EBP_MESSAGE, msg, sizeof(msg), NULL, 0, &envelope, &elen));
    assert(elen > 64); ebp_free(envelope);
    assert(!ebp_hd_child(NULL, 0, 1, node));
    for (int alg = EBP_ML_DSA_87; alg <= EBP_ML_KEM_1024; alg++) {
        uint8_t seed[96] = {0}, *pub = NULL, *priv = NULL, *value = NULL;
        size_t pub_len = 0, priv_len = 0, value_len = 0;
        size_t seed_len = alg == EBP_ML_DSA_87 ? 32 : alg == EBP_ML_KEM_1024 ? 64 : 96;
        assert(ebp_pq_keygen(alg, seed, seed_len, &pub, &pub_len, &priv, &priv_len));
        if (alg != EBP_ML_KEM_1024) {
            assert(ebp_pq_sign(alg, priv, priv_len, msg, sizeof(msg), &value, &value_len));
            assert(ebp_pq_verify(alg, pub, pub_len, msg, sizeof(msg), value, value_len));
            value[value_len - 1] ^= 1;
            assert(!ebp_pq_verify(alg, pub, pub_len, msg, sizeof(msg), value, value_len));
        } else {
            assert(ebp_kem_encrypt(pub, pub_len, msg, sizeof(msg), &value, &value_len));
            assert(ebp_kem_decrypt(priv, priv_len, value, value_len, &plain, &plen));
            assert(plen == sizeof(msg) && memcmp(plain, msg, plen) == 0);
            ebp_secure_free(plain, plen); plain = NULL;
            value[value_len - 1] ^= 1;
            assert(!ebp_kem_decrypt(priv, priv_len, value, value_len, &plain, &plen));
            assert(!plain && !plen);
        }
        ebp_free(value); ebp_free(pub); ebp_secure_free(priv, priv_len);
    }
    return 0;
}
