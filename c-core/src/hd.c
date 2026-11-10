#include "ebp_core.h"
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/kdf.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <utf8proc.h>
#include <jansson.h>

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

static int path_space(utf8proc_int32_t cp) {
    return (cp>=9 && cp<=13) || cp==0x20 || cp==0xa0 || cp==0x1680 ||
           (cp>=0x2000 && cp<=0x200a) || cp==0x2028 || cp==0x2029 || cp==0x202f || cp==0x205f || cp==0x3000 || cp==0xfeff;
}
static int trim_path(const uint8_t **path, size_t *len) {
    size_t pos=0,start=0,end=0; int found=0;
    if (!*path || *len>PTRDIFF_MAX) return 0;
    while (pos<*len) {
        utf8proc_int32_t cp; size_t before=pos;
        utf8proc_ssize_t n=utf8proc_iterate(*path+pos,(utf8proc_ssize_t)(*len-pos),&cp);
        if (n<=0) return 0;
        pos+=(size_t)n;
        if (!path_space(cp)) { if (!found) start=before; end=pos; found=1; }
    }
    if (!found) return 0;
    *path+=start; *len=end-start; return 1;
}
static int segment(const uint8_t *text, size_t len, size_t position, uint32_t *index, int *hardened) {
    uint32_t value=0; size_t bare=len;
    if (!len) return 0;
    *hardened=text[len-1]=='\'';
    if (*hardened) bare--;
    if (!bare) return 0;
    if (position==0) {
        if (bare!=3 || memcmp(text,"ebp",3)!=0 || !*hardened) return 0;
        *index=0x454250u; return 1;
    }
    if (position==1 && ((bare==9 && memcmp(text,"dilithium",9)==0) || (bare==7 && memcmp(text,"sphincs",7)==0))) {
        if (!*hardened) return 0;
        *index=bare==9?0u:1u; return 1;
    }
    for (size_t i=0; i<bare; i++) {
        unsigned digit;
        if (text[i]<'0' || text[i]>'9') return 0;
        digit=(unsigned)(text[i]-'0');
        if (value>(0x7fffffffu-digit)/10u) return 0;
        value=value*10u+digit;
    }
    if (position==2 && !*hardened) return 0;
    if ((position==1 || position==3) && value>1) return 0;
    *index=value; return 1;
}
int ebp_hd_parse_path(const uint8_t *path, size_t path_len, ebp_hd_path *parsed) {
    const uint8_t *original=path;
    size_t start=2, count=0;
    if (!parsed) return 0;
    memset(parsed,0,sizeof(*parsed));
    if (!trim_path(&path,&path_len) || path_len<3 || path[0]!='m' || path[1]!='/') return 0;
    parsed->normalized_offset=(size_t)(path-original); parsed->normalized_len=path_len;
    for (size_t i=2; i<=path_len; i++) {
        if (i==path_len || path[i]=='/') {
            if (count>=5 || !segment(path+start,i-start,count,&parsed->indices[count],&parsed->hardened[count])) return 0;
            count++; start=i+1;
        }
    }
    return count==5;
}
int ebp_hd_format_path(int sphincs, uint32_t account, int change, uint32_t index, uint8_t **out, size_t *out_len) {
    char path[96]; int n; uint8_t *copy;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((sphincs!=0 && sphincs!=1) || (change!=0 && change!=1) || account>=0x80000000u || index>=0x80000000u) return 0;
    n=snprintf(path,sizeof(path),"m/ebp'/%s'/%u'/%d/%u",sphincs?"sphincs":"dilithium",(unsigned)account,change,(unsigned)index);
    if (n<0 || (size_t)n>=sizeof(path) || !(copy=malloc((size_t)n))) return 0;
    memcpy(copy,path,(size_t)n); *out=copy; *out_len=(size_t)n; return 1;
}
int ebp_hd_provenance(const uint8_t *path, size_t path_len, uint8_t **out, size_t *out_len) {
    ebp_hd_path p; json_t *obj=NULL; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!ebp_hd_parse_path(path,path_len,&p)) return 0;
    obj=json_pack("{s:s,s:s,s:I,s:s,s:I}","version","ebp-hd-v1",
                  "profile",p.indices[1]?"sphincs":"dilithium","account",(json_int_t)p.indices[2],
                  "change",p.indices[3]?"internal":"external","index",(json_int_t)p.indices[4]);
    if (!obj || json_object_set_new(obj,"path",json_stringn((const char *)path+p.normalized_offset,p.normalized_len))!=0 ||
        !(text=json_dumps(obj,JSON_COMPACT))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(obj); return ok;
}
int ebp_hd_derive_path(const uint8_t *seed, size_t seed_len, const uint8_t *path, size_t path_len,
                       uint8_t node[64], int *profile) {
    ebp_hd_path parsed; int which=0, ok=0; uint8_t current[64], next[64];
    if (!node || !profile) return 0;
    OPENSSL_cleanse(node,64); *profile=0;
    if ((!seed && seed_len) || !ebp_hd_parse_path(path,path_len,&parsed)) return 0;
    which=(int)parsed.indices[1];
    if (!ebp_hd_master(seed,seed_len,current)) goto done;
    for (size_t i=0; i<5; i++) {
        uint32_t child=parsed.indices[i]+(parsed.hardened[i]?0x80000000u:0u);
        if (!ebp_hd_child(current,child,(uint32_t)i+1,next)) goto done;
        memcpy(current,next,sizeof(current));
    }
    memcpy(node,current,64); *profile=which; ok=1;
done:
    OPENSSL_cleanse(current,sizeof(current)); OPENSSL_cleanse(next,sizeof(next));
    OPENSSL_cleanse(&parsed,sizeof(parsed)); return ok;
}
