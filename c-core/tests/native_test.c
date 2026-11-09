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
        uint8_t *derived_pub = NULL; size_t derived_len = 0;
        assert(ebp_pq_public_from_private(alg, priv, priv_len, &derived_pub, &derived_len));
        assert(derived_len == pub_len && memcmp(derived_pub, pub, pub_len) == 0);
        ebp_free(derived_pub);
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
            ebp_free(value); value = NULL;
            uint8_t content_key[32] = {0}, unwrapped[32] = {0}, nonce[12];
            assert(ebp_wrap_content_key(pub, pub_len, content_key, &value, &value_len));
            assert(ebp_unwrap_content_key(priv, priv_len, value, value_len, unwrapped));
            assert(memcmp(content_key, unwrapped, sizeof(content_key)) == 0);
            ebp_free(value); value = NULL;
            assert(ebp_content_encrypt(content_key, msg, sizeof(msg), nonce, &value, &value_len));
            assert(ebp_content_decrypt(content_key, nonce, value, value_len, &plain, &plen));
            assert(plen == sizeof(msg) && memcmp(plain, msg, plen) == 0);
            ebp_secure_free(plain, plen); plain = NULL;
            value[value_len - 1] ^= 1;
            assert(!ebp_content_decrypt(content_key, nonce, value, value_len, &plain, &plen));
        }
        ebp_free(value); ebp_free(pub); ebp_secure_free(priv, priv_len);
    }
    {
        ebp_identity *original = NULL, *loaded = NULL, *public_only = NULL;
        uint8_t *storage = NULL, *signature = NULL, *phrase = NULL, *entropy = NULL;
        size_t storage_len = 0, signature_len = 0, phrase_len = 0, entropy_len = 0;
        uint8_t input_entropy[16] = {0}, seed[64];
        const uint8_t password[] = "password";
        uint8_t *file_json=NULL,*file_data=NULL,*filename=NULL,*mime=NULL;
        size_t file_json_len=0,file_len=0,filename_len=0,mime_len=0;
        assert(ebp_file_envelope_create(msg,sizeof(msg),(const uint8_t *)"f",1,(const uint8_t *)"x",1,&file_json,&file_json_len));
        assert(ebp_file_envelope_parse(file_json,file_json_len,&file_data,&file_len,&filename,&filename_len,&mime,&mime_len));
        assert(file_len==sizeof(msg) && memcmp(file_data,msg,file_len)==0);
        ebp_secure_free(file_json,file_json_len); ebp_secure_free(file_data,file_len); ebp_free(filename); ebp_free(mime);
        assert(ebp_entropy_to_mnemonic(input_entropy, sizeof(input_entropy), &phrase, &phrase_len));
        assert(ebp_mnemonic_to_entropy(phrase, phrase_len, &entropy, &entropy_len));
        assert(entropy_len == sizeof(input_entropy) && memcmp(input_entropy, entropy, entropy_len) == 0);
        assert(ebp_mnemonic_to_seed(phrase, phrase_len, NULL, 0, seed));
        const uint8_t hd_path[]="m/ebp'/dilithium'/0'/0/0"; int profile=-1;
        assert(ebp_hd_derive_path(seed,sizeof(seed),hd_path,sizeof(hd_path)-1,node,&profile));
        assert(profile==0);
        ebp_secure_free(phrase, phrase_len); ebp_secure_free(entropy, entropy_len);
        assert(ebp_identity_create(0, &original));
        assert(ebp_identity_store(original, password, sizeof(password)-1, &storage, &storage_len));
        assert(ebp_identity_load(storage, storage_len, password, sizeof(password)-1, 1, &loaded));
        assert(ebp_identity_load(storage, storage_len, NULL, 0, 0, &public_only));
        assert(ebp_identity_is_private(loaded) && !ebp_identity_is_private(public_only));
        assert(ebp_identity_sign(loaded, EBP_MESSAGE, msg, sizeof(msg), NULL, 0, &signature, &signature_len));
        assert(ebp_identity_verify(public_only, EBP_MESSAGE, msg, sizeof(msg), NULL, 0, signature, signature_len));
        ebp_free(signature); signature = NULL;
        uint8_t *public_json = NULL; size_t public_json_len = 0; ebp_identity *public_export = NULL;
        assert(ebp_identity_public_json(original, &public_json, &public_json_len));
        assert(ebp_identity_from_public_json(public_json, public_json_len, &public_export));
        assert(!ebp_identity_is_private(public_export));
        ebp_free(public_json); ebp_identity_free(public_export);
        assert(ebp_identity_attach_detail(loaded, (const uint8_t *)"email", 5, (const uint8_t *)"value", 5, 10));
        assert(ebp_identity_get_detail(loaded, (const uint8_t *)"email", 5, &plain, &plen));
        assert(plen == 5 && memcmp(plain, "value", 5) == 0);
        ebp_secure_free(plain, plen); plain = NULL;
        uint8_t *proof = NULL, *cert = NULL; size_t proof_len = 0, cert_len = 0;
        assert(ebp_detail_proof_create(loaded, (const uint8_t *)"name", 4, (const uint8_t *)"value", 5, 5, 10, &proof, &proof_len));
        assert(ebp_revocation_create(loaded, 1, 5, 10, NULL, 0, (const uint8_t *)"name", 4, &cert, &cert_len));
        assert(ebp_revocation_verify(public_only, cert, cert_len, 1, (const uint8_t *)"name", 4));
        assert(!ebp_revocation_verify(public_only, cert, cert_len, 1, (const uint8_t *)"bad", 3));
        ebp_free(cert); cert = NULL;
        assert(ebp_identity_revoke(loaded, 1, (const uint8_t *)"email", 5, NULL, 0, 11, &cert, &cert_len));
        assert(ebp_identity_is_detail_revoked(loaded, (const uint8_t *)"email", 5));
        assert(!ebp_identity_get_detail(loaded, (const uint8_t *)"email", 5, &plain, &plen));
        ebp_free(cert); cert = NULL;
        ebp_identity *child = NULL;
        assert(ebp_identity_create(0, &child));
        assert(ebp_hierarchy_create(loaded, child, 10, 0, NULL, 0, (const uint8_t *)"salt", 4, &cert, &cert_len));
        assert(ebp_hierarchy_verify(public_only, child, cert, cert_len));
        assert(!ebp_hierarchy_verify(child, public_only, cert, cert_len));
        const ebp_identity *members[] = {public_only, child};
        const uint8_t manifest[] = "[{\"attachmentId\":\"é\",\"ciphertextSha256\":\"aa\"},{\"attachmentId\":\"a\",\"ciphertextSha256\":\"bb\"}]";
        uint8_t *packet=NULL, *result=NULL; size_t packet_len=0, result_len=0;
        assert(ebp_identity_sign_encrypt_many(loaded, members, 2, (const uint8_t *)"hello", 5,
                                              manifest, sizeof(manifest)-1, NULL, NULL, &packet, &packet_len));
        assert(ebp_identity_decrypt_verify_many(child, public_only, packet, packet_len, NULL, &result, &result_len));
        ebp_secure_free(packet,packet_len); ebp_secure_free(result,result_len);
        ebp_free(proof); ebp_free(cert); ebp_free(storage); ebp_identity_free(child);
        ebp_identity_free(public_only); ebp_identity_free(loaded); ebp_identity_free(original);
    }
    return 0;
}
