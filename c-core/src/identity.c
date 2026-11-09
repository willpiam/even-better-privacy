#include "ebp_core.h"
#include <jansson.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

#define PROTOCOL_VERSION "0.1.1"
static const uint8_t identity_aad[] = "ebp:identity-storage:v2";
struct ebp_identity {
    int sphincs;
    uint8_t *sign_pub, *sign_priv, *kem_pub, *kem_priv;
    size_t sign_pub_len, sign_priv_len, kem_pub_len, kem_priv_len;
    json_t *public_data;
};
void ebp_identity_free(ebp_identity *id) {
    if (!id) return;
    free(id->sign_pub); free(id->kem_pub);
    ebp_secure_free(id->sign_priv, id->sign_priv_len);
    ebp_secure_free(id->kem_priv, id->kem_priv_len);
    json_decref(id->public_data); OPENSSL_cleanse(id, sizeof(*id)); free(id);
}
int ebp_identity_is_private(const ebp_identity *id) { return id && id->sign_priv && id->kem_priv; }
static const char *variant(int sphincs) { return sphincs ? "slh_dsa_sha2_256s" : "ml_dsa87"; }
static int sign_alg(int sphincs) { return sphincs ? EBP_SLH_DSA_SHA2_256S : EBP_ML_DSA_87; }
static const char *strfield(const json_t *obj, const char *key) {
    const json_t *value = json_is_object(obj) ? json_object_get(obj,key) : NULL;
    const char *text = json_string_value(value);
    return text && strlen(text) == json_string_length(value) ? text : NULL;
}
static int equals(const char *a, const char *b) { return a && b && strcmp(a, b) == 0; }
static char *b64encode(const uint8_t *data, size_t len) {
    size_t n; char *out;
    if (!data || len > (size_t)(INT_MAX / 4) * 3) return NULL;
    n = 4 * ((len + 2) / 3); out = malloc(n + 1);
    if (!out) return NULL;
    if (EVP_EncodeBlock((uint8_t *)out, data, (int)len) != (int)n) { free(out); return NULL; }
    return out;
}
static int b64decode(const char *str, uint8_t **out, size_t *len) {
    size_t n, pad = 0; uint8_t *buf = NULL; char *encoded = NULL; int actual, ok = 0;
    if (!str || !out || !len) return 0;
    *out = NULL; *len = 0; n = strlen(str);
    if (!n || n % 4 || n > INT_MAX) return 0;
    if (str[n-1] == '=') pad++;
    if (n > 1 && str[n-2] == '=') pad++;
    buf = malloc(n / 4 * 3); if (!buf) return 0;
    actual = EVP_DecodeBlock(buf, (const uint8_t *)str, (int)n);
    if (actual < 0 || (size_t)actual < pad) goto done;
    *len = (size_t)actual - pad;
    encoded = b64encode(buf, *len);
    if (!equals(encoded, str)) goto done;
    *out = buf; buf = NULL; ok = 1;
done:
    free(encoded); ebp_secure_free(buf, n / 4 * 3); if (!ok) *len = 0; return ok;
}
static char *hexencode(const uint8_t *data, size_t len) {
    static const char alphabet[] = "0123456789abcdef"; char *out;
    if (!data || len > (SIZE_MAX-1)/2) return NULL;
    out = malloc(len*2+1); if (!out) return NULL;
    for (size_t i=0; i<len; i++) { out[i*2]=alphabet[data[i]>>4]; out[i*2+1]=alphabet[data[i]&15]; }
    out[len*2]='\0'; return out;
}
static int hexval(char c) {
    if (c >= '0' && c <= '9') return c-'0';
    if (c >= 'a' && c <= 'f') return c-'a'+10;
    if (c >= 'A' && c <= 'F') return c-'A'+10;
    return -1;
}
static int hexdecode(const char *str, uint8_t **out, size_t *len) {
    size_t n; uint8_t *buf;
    if (!str || !out || !len) return 0;
    *out = NULL; *len = 0; n = strlen(str);
    if (!n || n%2) return 0;
    buf = malloc(n/2); if (!buf) return 0;
    for (size_t i=0; i<n/2; i++) {
        int hi=hexval(str[2*i]), lo=hexval(str[2*i+1]);
        if (hi < 0 || lo < 0) { ebp_secure_free(buf, n/2); return 0; }
        buf[i]=(uint8_t)((hi<<4)|lo);
    }
    *out=buf; *len=n/2; return 1;
}
static void wipe_json_strings(json_t *value) {
    if (json_is_string(value)) {
        const char *str=json_string_value(value);
        if (str) OPENSSL_cleanse((void *)str, json_string_length(value));
    } else if (json_is_object(value)) {
        const char *key; json_t *child;
        json_object_foreach(value, key, child) { (void)key; wipe_json_strings(child); }
    } else if (json_is_array(value)) {
        size_t i; json_t *child;
        json_array_foreach(value, i, child) wipe_json_strings(child);
    }
}
static int dump_json(json_t *obj, uint8_t **out, size_t *out_len) {
    char *encoded;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0; encoded=json_dumps(obj, JSON_COMPACT | JSON_ENSURE_ASCII);
    if (!encoded) return 0;
    *out=(uint8_t *)encoded; *out_len=strlen(encoded); return 1;
}
static int validate_public(ebp_identity *id) {
    json_t *pub=id->public_data, *sign_details, *kem_details;
    const char *profile, *fp, *sign, *kem;
    char computed[65];
    if (!json_is_object(pub)) return 0;
    profile=strfield(pub,"signingKeyType");
    if (equals(profile,"dilithium")) id->sphincs=0;
    else if (equals(profile,"sphincs")) id->sphincs=1;
    else return 0;
    sign_details=json_object_get(pub,"signingKeyDetails"); kem_details=json_object_get(pub,"encryptionKeyDetails");
    fp=strfield(pub,"fingerprint"); sign=strfield(pub,"signingKey"); kem=strfield(pub,"encryptionKey");
    if (!equals(strfield(pub,"encryptionKeyType"),"kyber") ||
        !equals(strfield(sign_details,"variant"),variant(id->sphincs)) ||
        !equals(strfield(kem_details,"variant"),"ml_kem1024") ||
        !b64decode(sign,&id->sign_pub,&id->sign_pub_len) ||
        !hexdecode(kem,&id->kem_pub,&id->kem_pub_len)) return 0;
    if (id->sign_pub_len != (id->sphincs ? 64u : 2592u) || id->kem_pub_len != 1568u ||
        !ebp_identity_fingerprint(id->sphincs,id->sign_pub,id->sign_pub_len,id->kem_pub,id->kem_pub_len,computed) ||
        !equals(fp,computed)) return 0;
    return 1;
}
int ebp_identity_from_public_json(const uint8_t *data, size_t len, ebp_identity **out) {
    json_error_t error; json_t *obj=NULL,*version; ebp_identity *id=NULL; int ok=0;
    if (!out) return 0;
    *out=NULL;
    if (!data || !len) return 0;
    obj=json_loadb((const char *)data,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(obj)) goto done;
    version=json_object_get(obj,"version");
    if (version && (!json_is_integer(version) || json_integer_value(version)!=1)) goto done;
    id=calloc(1,sizeof(*id)); if (!id) goto done;
    id->public_data=obj; obj=NULL;
    if (!validate_public(id)) goto done;
    *out=id; id=NULL; ok=1;
done:
    json_decref(obj); ebp_identity_free(id); return ok;
}
static int equal_key(const uint8_t *a, size_t alen, const uint8_t *b, size_t blen) {
    return a && b && alen == blen && CRYPTO_memcmp(a,b,alen) == 0;
}
static int identity_create_with_seeds(int sphincs, const uint8_t *sign_seed, size_t sign_len,
                                      const uint8_t *kem_seed, size_t kem_len, ebp_identity **out) {
    ebp_identity *id=NULL; char fingerprint[65], *sign=NULL, *kem=NULL; int ok=0;
    if (!out) return 0;
    *out=NULL;
    if (sphincs != 0 && sphincs != 1) return 0;
    id=calloc(1,sizeof(*id)); if (!id) return 0;
    id->sphincs=sphincs;
    if (!ebp_pq_keygen(sign_alg(sphincs),sign_seed,sign_len,&id->sign_pub,&id->sign_pub_len,&id->sign_priv,&id->sign_priv_len) ||
        !ebp_pq_keygen(EBP_ML_KEM_1024,kem_seed,kem_len,&id->kem_pub,&id->kem_pub_len,&id->kem_priv,&id->kem_priv_len) ||
        !ebp_identity_fingerprint(sphincs,id->sign_pub,id->sign_pub_len,id->kem_pub,id->kem_pub_len,fingerprint)) goto done;
    sign=b64encode(id->sign_pub,id->sign_pub_len); kem=hexencode(id->kem_pub,id->kem_pub_len);
    if (!sign || !kem) goto done;
    id->public_data=json_pack("{s:s,s:s,s:s,s:s,s:s,s:{s:s},s:{s:s},s:{},s:i,s:s,s:{},s:i}",
        "fingerprint",fingerprint, "signingKeyType",sphincs?"sphincs":"dilithium", "encryptionKeyType","kyber",
        "signingKey",sign, "encryptionKey",kem, "signingKeyDetails","variant",variant(sphincs),
        "encryptionKeyDetails","variant","ml_kem1024", "details", "detailsNonce",0,
        "protocolVersion",PROTOCOL_VERSION, "revokedDetails", "revocationNonce",0);
    if (!id->public_data) goto done;
    *out=id; id=NULL; ok=1;
done:
    free(sign); free(kem); ebp_identity_free(id); return ok;
}
int ebp_identity_create(int sphincs, ebp_identity **out) {
    return identity_create_with_seeds(sphincs,NULL,0,NULL,0,out);
}
int ebp_identity_from_hd_seed(const uint8_t *seed, size_t seed_len, int sphincs,
                              uint32_t account, int change, uint32_t index, ebp_identity **out) {
    ebp_identity *id=NULL; json_t *provenance=NULL;
    uint8_t node[64], child[64], sign_seed[96], kem_seed[64];
    uint32_t segments[5]; char path[96]; int ok=0;
    if (!out) return 0;
    *out=NULL;
    if ((!seed && seed_len) || (sphincs != 0 && sphincs != 1) || (change != 0 && change != 1) ||
        account >= 0x80000000u || index >= 0x80000000u) return 0;
    segments[0]=0x80454250u; segments[1]=0x80000000u+(uint32_t)sphincs;
    segments[2]=0x80000000u+account; segments[3]=(uint32_t)change; segments[4]=index;
    if (!ebp_hd_master(seed,seed_len,node)) goto done;
    for (uint32_t i=0; i<5; i++) {
        if (!ebp_hd_child(node,segments[i],i+1,child)) goto done;
        memcpy(node,child,sizeof(node));
    }
    if (!ebp_hd_identity_seeds(node,sphincs,sign_seed,sphincs?96:32,kem_seed) ||
        !identity_create_with_seeds(sphincs,sign_seed,sphincs?96:32,kem_seed,64,&id)) goto done;
    snprintf(path,sizeof(path),"m/ebp'/%s'/%u'/%d/%u",sphincs?"sphincs":"dilithium",(unsigned)account,change,(unsigned)index);
    provenance=json_pack("{s:s,s:s,s:s,s:I,s:s,s:I}","version","ebp-hd-v1","path",path,
                         "profile",sphincs?"sphincs":"dilithium","account",(json_int_t)account,
                         "change",change?"internal":"external","index",(json_int_t)index);
    if (!provenance || json_object_set(id->public_data,"hdProvenance",provenance) != 0) goto done;
    *out=id; id=NULL; ok=1;
done:
    json_decref(provenance); ebp_identity_free(id); OPENSSL_cleanse(node,sizeof(node));
    OPENSSL_cleanse(child,sizeof(child)); OPENSSL_cleanse(sign_seed,sizeof(sign_seed)); OPENSSL_cleanse(kem_seed,sizeof(kem_seed)); return ok;
}
int ebp_identity_public_json(const ebp_identity *id, uint8_t **out, size_t *len) {
    if (!id || !id->public_data) return 0;
    return dump_json(id->public_data,out,len);
}
static char *key_json(const char *name, const uint8_t *pub, size_t pub_len,
                      const uint8_t *priv, size_t priv_len, int use_hex) {
    uint8_t digest[32]; char *pubstr=NULL,*privstr=NULL,*fp=NULL,*out=NULL; json_t *obj=NULL;
    if (!ebp_sha256(pub,pub_len,digest)) goto done;
    fp=hexencode(digest,sizeof(digest));
    pubstr=use_hex?hexencode(pub,pub_len):b64encode(pub,pub_len);
    privstr=use_hex?hexencode(priv,priv_len):b64encode(priv,priv_len);
    if (!fp || !pubstr || !privstr) goto done;
    obj=json_pack("{s:s,s:s,s:s,s:s}","variant",name,"fingerprint",fp,"publicKey",pubstr,"secretKey",privstr);
    if (obj) out=json_dumps(obj,JSON_COMPACT | JSON_ENSURE_ASCII);
done:
    if (obj) { wipe_json_strings(obj); json_decref(obj); }
    if (privstr) ebp_secure_free(privstr,strlen(privstr));
    free(pubstr); free(fp); OPENSSL_cleanse(digest,sizeof(digest)); return out;
}
int ebp_identity_store(const ebp_identity *id, const uint8_t *password, size_t password_len,
                       uint8_t **out, size_t *out_len) {
    char *sign=NULL,*kem=NULL,*private_text=NULL,*encoded=NULL;
    json_t *private_obj=NULL,*storage=NULL;
    uint8_t salt[16], key[32]={0}, *cipher=NULL; size_t cipher_len=0; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!ebp_identity_is_private(id) || (!password && password_len)) return 0;
    sign=key_json(variant(id->sphincs),id->sign_pub,id->sign_pub_len,id->sign_priv,id->sign_priv_len,0);
    kem=key_json("ml_kem1024",id->kem_pub,id->kem_pub_len,id->kem_priv,id->kem_priv_len,1);
    if (!sign || !kem) goto done;
    private_obj=json_pack("{s:s,s:s,s:s,s:s}","signingKey",sign,"encryptionKey",kem,
                          "signingKeyType",id->sphincs?"sphincs":"dilithium","encryptionKeyType","kyber");
    if (!private_obj || !(private_text=json_dumps(private_obj,JSON_COMPACT | JSON_ENSURE_ASCII)) ||
        RAND_bytes(salt,sizeof(salt)) != 1 || !ebp_derive_storage_key(password,password_len,salt,key) ||
        !ebp_aes_encrypt(key,salt,(const uint8_t *)private_text,strlen(private_text),identity_aad,sizeof(identity_aad)-1,&cipher,&cipher_len) ||
        !(encoded=b64encode(cipher,cipher_len))) goto done;
    storage=json_pack("{s:i,s:s,s:O,s:s}","version",2,"protocolVersion",PROTOCOL_VERSION,"public",id->public_data,"encrypted",encoded);
    if (!storage || !dump_json(storage,out,out_len)) goto done;
    ok=1;
done:
    if (sign) ebp_secure_free(sign,strlen(sign));
    if (kem) ebp_secure_free(kem,strlen(kem));
    if (private_text) ebp_secure_free(private_text,strlen(private_text));
    if (private_obj) { wipe_json_strings(private_obj); json_decref(private_obj); }
    json_decref(storage); free(encoded); free(cipher); OPENSSL_cleanse(key,sizeof(key)); OPENSSL_cleanse(salt,sizeof(salt)); return ok;
}
static int validate_keypair(int alg, const uint8_t *pub, size_t pub_len, const uint8_t *priv, size_t priv_len) {
    static const uint8_t challenge[] = "ebp::identity-storage::key-check::v1";
    uint8_t *data = NULL, left[32] = {0}, right[32] = {0};
    size_t len = 0; int ok = 0;
    if (alg == EBP_ML_KEM_1024) {
        if (ebp_pq_encapsulate(pub,pub_len,&data,&len,left) &&
            ebp_pq_decapsulate(priv,priv_len,data,len,right) &&
            CRYPTO_memcmp(left,right,sizeof(left)) == 0) ok = 1;
    } else {
        if (ebp_pq_sign(alg,priv,priv_len,challenge,sizeof(challenge)-1,&data,&len) &&
            ebp_pq_verify(alg,pub,pub_len,challenge,sizeof(challenge)-1,data,len)) ok = 1;
    }
    free(data); OPENSSL_cleanse(left,sizeof(left)); OPENSSL_cleanse(right,sizeof(right)); return ok;
}
static int import_private_json(ebp_identity *id, const char *encoded, int is_signing) {
    json_error_t error; json_t *obj=NULL;
    uint8_t *pub=NULL,*priv=NULL,*derived=NULL; size_t pub_len=0,priv_len=0,derived_len=0;
    const char *expect_variant=is_signing?variant(id->sphincs):"ml_kem1024";
    const uint8_t *expected_pub=is_signing?id->sign_pub:id->kem_pub;
    size_t expected_len=is_signing?id->sign_pub_len:id->kem_pub_len;
    int alg=is_signing?sign_alg(id->sphincs):EBP_ML_KEM_1024, ok=0;
    if (!encoded || !(obj=json_loads(encoded,JSON_REJECT_DUPLICATES,&error)) ||
        !json_is_object(obj) || !equals(strfield(obj,"variant"),expect_variant)) goto done;
    if (is_signing) {
        if (!b64decode(strfield(obj,"publicKey"),&pub,&pub_len) || !b64decode(strfield(obj,"secretKey"),&priv,&priv_len)) goto done;
    } else {
        if (!hexdecode(strfield(obj,"publicKey"),&pub,&pub_len) || !hexdecode(strfield(obj,"secretKey"),&priv,&priv_len)) goto done;
    }
    if (!equal_key(pub,pub_len,expected_pub,expected_len) ||
        !ebp_pq_public_from_private(alg,priv,priv_len,&derived,&derived_len) ||
        !equal_key(derived,derived_len,expected_pub,expected_len) ||
        !validate_keypair(alg,expected_pub,expected_len,priv,priv_len)) goto done;
    if (is_signing) { id->sign_priv=priv; id->sign_priv_len=priv_len; }
    else { id->kem_priv=priv; id->kem_priv_len=priv_len; }
    priv=NULL; ok=1;
done:
    if (obj) { wipe_json_strings(obj); json_decref(obj); }
    free(pub); free(derived); ebp_secure_free(priv,priv_len); return ok;
}
int ebp_identity_load(const uint8_t *data, size_t len, const uint8_t *password, size_t password_len,
                      int unlock, ebp_identity **out) {
    json_error_t error; json_t *root=NULL,*private_obj=NULL,*pub,*version;
    ebp_identity *id=NULL; uint8_t *cipher=NULL,*plain=NULL, key[32]={0};
    size_t cipher_len=0,plain_len=0; const char *encoded; int ok=0;
    if (!out) return 0;
    *out=NULL;
    if (!data || !len || (unlock != 0 && unlock != 1) || (!password && password_len)) return 0;
    root=json_loadb((const char *)data,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(root)) goto done;
    version=json_object_get(root,"version"); pub=json_object_get(root,"public"); encoded=strfield(root,"encrypted");
    if (!json_is_integer(version) || json_integer_value(version)!=2 || !equals(strfield(root,"protocolVersion"),PROTOCOL_VERSION) ||
        !json_is_object(pub) || !encoded) goto done;
    id=calloc(1,sizeof(*id)); if (!id || !(id->public_data=json_deep_copy(pub)) || !validate_public(id)) goto done;
    if (unlock) {
        if (!b64decode(encoded,&cipher,&cipher_len) || cipher_len < 45 || cipher[0] != 4 ||
            !ebp_derive_storage_key(password,password_len,cipher+1,key) ||
            !ebp_aes_decrypt(key,cipher,cipher_len,identity_aad,sizeof(identity_aad)-1,&plain,&plain_len)) goto done;
        private_obj=json_loadb((const char *)plain,plain_len,JSON_REJECT_DUPLICATES,&error);
        if (!json_is_object(private_obj) ||
            !equals(strfield(private_obj,"signingKeyType"),id->sphincs?"sphincs":"dilithium") ||
            !equals(strfield(private_obj,"encryptionKeyType"),"kyber") ||
            !import_private_json(id,strfield(private_obj,"signingKey"),1) ||
            !import_private_json(id,strfield(private_obj,"encryptionKey"),0)) goto done;
    }
    *out=id; id=NULL; ok=1;
done:
    if (private_obj) { wipe_json_strings(private_obj); json_decref(private_obj); }
    json_decref(root); free(cipher); ebp_secure_free(plain,plain_len);
    OPENSSL_cleanse(key,sizeof(key)); ebp_identity_free(id); return ok;
}
int ebp_identity_sign(const ebp_identity *id, int purpose, const uint8_t *message, size_t message_len,
                      const uint8_t *salt, size_t salt_len, uint8_t **signature, size_t *signature_len) {
    uint8_t *envelope=NULL; size_t len=0; int ok=0;
    if (!signature || !signature_len) return 0;
    *signature=NULL; *signature_len=0;
    if (!ebp_identity_is_private(id) || !ebp_message_envelope(purpose,message,message_len,salt,salt_len,&envelope,&len)) return 0;
    ok=ebp_pq_sign(sign_alg(id->sphincs),id->sign_priv,id->sign_priv_len,envelope,len,signature,signature_len);
    ebp_secure_free(envelope,len); return ok;
}
int ebp_identity_verify(const ebp_identity *id, int purpose, const uint8_t *message, size_t message_len,
                        const uint8_t *salt, size_t salt_len, const uint8_t *signature, size_t signature_len) {
    uint8_t *envelope=NULL; size_t len=0; int ok=0;
    if (!id || !ebp_message_envelope(purpose,message,message_len,salt,salt_len,&envelope,&len)) return 0;
    ok=ebp_pq_verify(sign_alg(id->sphincs),id->sign_pub,id->sign_pub_len,envelope,len,signature,signature_len);
    ebp_secure_free(envelope,len); return ok;
}
int ebp_identity_sign_encrypt(const ebp_identity *sender, const ebp_identity *recipient,
                              const uint8_t *message, size_t message_len, uint8_t **ciphertext, size_t *ciphertext_len) {
    const char *fingerprint; json_t *inner=NULL; char *sig64=NULL,*json=NULL;
    uint8_t *envelope=NULL,*signature=NULL; size_t envelope_len=0,signature_len=0; int ok=0;
    if (!ciphertext || !ciphertext_len) return 0;
    *ciphertext=NULL; *ciphertext_len=0;
    if (!ebp_identity_is_private(sender) || !recipient || (!message && message_len)) return 0;
    fingerprint=strfield(recipient->public_data,"fingerprint");
    if (!fingerprint || !ebp_recipient_envelope((const uint8_t *)fingerprint,strlen(fingerprint),message,message_len,NULL,0,&envelope,&envelope_len) ||
        !ebp_pq_sign(sign_alg(sender->sphincs),sender->sign_priv,sender->sign_priv_len,envelope,envelope_len,&signature,&signature_len) ||
        !(sig64=b64encode(signature,signature_len))) goto done;
    inner=json_object();
    if (!inner || json_object_set_new(inner,"type",json_string("ebp-encrypted-signed-inner"))!=0 ||
        json_object_set_new(inner,"message",json_stringn((const char *)(message?message:(const uint8_t *)""),message_len))!=0 ||
        json_object_set_new(inner,"signature",json_string(sig64))!=0 ||
        json_object_set_new(inner,"envelopeVersion",json_integer(2))!=0 ||
        json_object_set_new(inner,"recipientFingerprint",json_string(fingerprint))!=0 ||
        !(json=json_dumps(inner,JSON_COMPACT)) ||
        !ebp_kem_encrypt(recipient->kem_pub,recipient->kem_pub_len,(const uint8_t *)json,strlen(json),ciphertext,ciphertext_len)) goto done;
    ok=1;
done:
    if (inner) { wipe_json_strings(inner); json_decref(inner); }
    if (json) ebp_secure_free(json,strlen(json));
    ebp_secure_free(envelope,envelope_len); free(signature); free(sig64); return ok;
}
int ebp_identity_decrypt_verify(const ebp_identity *recipient, const ebp_identity *sender,
                                const uint8_t *ciphertext, size_t ciphertext_len,
                                uint8_t **message, size_t *message_len, int *verified) {
    uint8_t *plain=NULL,*signature=NULL,*envelope=NULL,*output=NULL;
    size_t plain_len=0,signature_len=0,envelope_len=0,n;
    json_t *inner=NULL,*value,*vversion; json_error_t error;
    const char *text,*signature64,*fingerprint,*expected; int ok=0;
    if (!message || !message_len || !verified) return 0;
    *message=NULL; *message_len=0; *verified=0;
    if (!ebp_identity_is_private(recipient) || !sender ||
        !ebp_kem_decrypt(recipient->kem_priv,recipient->kem_priv_len,ciphertext,ciphertext_len,&plain,&plain_len)) goto done;
    inner=json_loadb((const char *)plain,plain_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(inner)) goto done;
    value=json_object_get(inner,"message"); text=json_string_value(value);
    if (!text) goto done;
    n=json_string_length(value);
    output=malloc(n?n:1); if (!output) goto done;
    if (n) memcpy(output,text,n);
    expected=strfield(recipient->public_data,"fingerprint"); fingerprint=strfield(inner,"recipientFingerprint");
    signature64=strfield(inner,"signature"); vversion=json_object_get(inner,"envelopeVersion");
    if (equals(strfield(inner,"type"),"ebp-encrypted-signed-inner") &&
        json_is_integer(vversion) && json_integer_value(vversion)==2 && equals(fingerprint,expected) &&
        b64decode(signature64,&signature,&signature_len) &&
        ebp_recipient_envelope((const uint8_t *)expected,strlen(expected),(const uint8_t *)text,n,NULL,0,&envelope,&envelope_len) &&
        ebp_pq_verify(sign_alg(sender->sphincs),sender->sign_pub,sender->sign_pub_len,envelope,envelope_len,signature,signature_len)) *verified=1;
    *message=output; *message_len=n; output=NULL; ok=1;
done:
    if (inner) { wipe_json_strings(inner); json_decref(inner); }
    ebp_secure_free(plain,plain_len); ebp_secure_free(output,output?n:0); free(signature); ebp_secure_free(envelope,envelope_len); return ok;
}
static char *detail_key(const uint8_t *path, size_t len) {
    char *key;
    if ((!path && len) || len==SIZE_MAX || (len && memchr(path,0,len))) return NULL;
    key=malloc(len+1); if (!key) return NULL;
    if (len) memcpy(key,path,len);
    key[len]='\0'; return key;
}
int ebp_identity_attach_detail(ebp_identity *id, const uint8_t *path, size_t path_len,
                               const uint8_t *detail, size_t detail_len, int64_t timestamp) {
    char *key=NULL; uint8_t *proof=NULL; size_t proof_len=0; json_t *copy=NULL,*details,*nonce_value,*pair=NULL;
    json_int_t nonce; int ok=0;
    if (!ebp_identity_is_private(id) || (!detail && detail_len) || !(key=detail_key(path,path_len))) return 0;
    copy=json_deep_copy(id->public_data); if (!copy) goto done;
    details=json_object_get(copy,"details");
    if (!details) { if (json_object_set_new(copy,"details",json_object())!=0) goto done; details=json_object_get(copy,"details"); }
    if (!json_is_object(details)) goto done;
    nonce_value=json_object_get(copy,"detailsNonce");
    if (nonce_value && !json_is_integer(nonce_value)) goto done;
    nonce=nonce_value?json_integer_value(nonce_value):0;
    if (nonce<0 || nonce>=INT64_C(9007199254740991) ||
        !ebp_detail_proof_create(id,path,path_len,detail,detail_len,(uint64_t)nonce,timestamp,&proof,&proof_len)) goto done;
    pair=json_array();
    if (!pair || json_array_append_new(pair,json_stringn((const char *)(detail?detail:(const uint8_t *)""),detail_len))!=0 ||
        json_array_append_new(pair,json_stringn((const char *)proof,proof_len))!=0 ||
        json_object_set(details,key,pair)!=0 || json_object_set_new(copy,"detailsNonce",json_integer(nonce+1))!=0) goto done;
    json_decref(id->public_data); id->public_data=copy; copy=NULL; ok=1;
done:
    free(key); ebp_secure_free(proof,proof_len); json_decref(pair); json_decref(copy); return ok;
}
int ebp_identity_get_detail(const ebp_identity *id, const uint8_t *path, size_t path_len,
                            uint8_t **out, size_t *out_len) {
    char *key=NULL; json_t *details,*pair,*detail,*proof; const char *text,*encoded;
    size_t n; uint8_t *copy=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!id || !(key=detail_key(path,path_len))) return 0;
    details=json_object_get(id->public_data,"details"); pair=json_is_object(details)?json_object_get(details,key):NULL;
    detail=json_is_array(pair)?json_array_get(pair,0):NULL; proof=json_is_array(pair)?json_array_get(pair,1):NULL;
    text=json_string_value(detail); encoded=json_string_value(proof);
    if (!text || !encoded || strlen(encoded)!=json_string_length(proof) ||
        !ebp_detail_proof_verify(sign_alg(id->sphincs),id->sign_pub,id->sign_pub_len,path,path_len,
                                 (const uint8_t *)text,json_string_length(detail),(const uint8_t *)encoded,strlen(encoded),NULL,NULL)) goto done;
    n=json_string_length(detail); copy=malloc(n?n:1); if (!copy) goto done;
    if (n) memcpy(copy,text,n);
    *out=copy; *out_len=n; copy=NULL; ok=1;
done:
    free(key); free(copy); return ok;
}
int ebp_identity_is_revoked(const ebp_identity *id) {
    json_t *value;
    if (!id) return 0;
    value=json_object_get(id->public_data,"revocationCertificate");
    return value && !json_is_null(value);
}
int ebp_identity_is_detail_revoked(const ebp_identity *id, const uint8_t *path, size_t path_len) {
    char *key; json_t *revoked; int found=0;
    if (!id || !(key=detail_key(path,path_len))) return 0;
    revoked=json_object_get(id->public_data,"revokedDetails");
    if (json_is_object(revoked) && json_object_get(revoked,key)) found=1;
    free(key); return found;
}
int ebp_identity_revoke(ebp_identity *id, int type, const uint8_t *target, size_t target_len,
                        const uint8_t *reason, size_t reason_len, int64_t timestamp,
                        uint8_t **certificate, size_t *certificate_len) {
    char *key=NULL; uint8_t *encoded=NULL; size_t encoded_len=0;
    json_t *copy=NULL,*details,*revoked,*nonce_value,*existing; json_int_t nonce; int ok=0;
    if (!certificate || !certificate_len) return 0;
    *certificate=NULL; *certificate_len=0;
    if (!ebp_identity_is_private(id) || (type!=1 && type!=2) || (!reason && reason_len)) return 0;
    if (type==1) {
        if (!target || !(key=detail_key(target,target_len))) return 0;
        details=json_object_get(id->public_data,"details");
        if (!json_is_object(details) || !json_object_get(details,key)) goto done;
    } else {
        if (target || target_len) goto done;
        existing=json_object_get(id->public_data,"revocationCertificate");
        if (json_is_string(existing) && json_string_length(existing)>0) goto done;
    }
    nonce_value=json_object_get(id->public_data,"revocationNonce");
    if (nonce_value && !json_is_integer(nonce_value)) goto done;
    nonce=nonce_value?json_integer_value(nonce_value):0;
    if (nonce<0 || nonce>=INT64_C(9007199254740991) ||
        !ebp_revocation_create(id,type,(uint64_t)nonce,timestamp,reason,reason_len,target,target_len,&encoded,&encoded_len) ||
        !(copy=json_deep_copy(id->public_data))) goto done;
    if (type==1) {
        details=json_object_get(copy,"details"); revoked=json_object_get(copy,"revokedDetails");
        if (!revoked) { if (json_object_set_new(copy,"revokedDetails",json_object())!=0) goto done; revoked=json_object_get(copy,"revokedDetails"); }
        if (!json_is_object(revoked) || json_object_set_new(revoked,key,json_stringn((const char *)encoded,encoded_len))!=0 ||
            json_object_del(details,key)!=0) goto done;
    } else if (json_object_set_new(copy,"revocationCertificate",json_stringn((const char *)encoded,encoded_len))!=0) goto done;
    if (json_object_set_new(copy,"revocationNonce",json_integer(nonce+1))!=0) goto done;
    json_decref(id->public_data); id->public_data=copy; copy=NULL;
    *certificate=encoded; *certificate_len=encoded_len; encoded=NULL; ok=1;
done:
    free(key); free(encoded); json_decref(copy); return ok;
}
