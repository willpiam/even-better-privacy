#include "ebp_core.h"
#include "json_compat.h"
#include <jansson.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <utf8proc.h>

#define MAX_SAFE_INTEGER INT64_C(9007199254740991)
static char *js_canonical_dump(const json_t *value) {
    char *text=json_dumps(value,JSON_COMPACT|JSON_SORT_KEYS);
    if (text) ebp_json_lowercase_escapes(text);
    return text;
}
static int add_value(json_t *obj, const char *key, json_t *value) {
    return value && json_object_set_new(obj,key,value) == 0;
}
static json_t *unsigned_proof(const uint8_t *path, size_t path_len, const uint8_t *detail, size_t detail_len,
                              uint64_t nonce, int64_t timestamp) {
    json_t *obj;
    if ((!path && path_len) || (!detail && detail_len) || nonce > MAX_SAFE_INTEGER ||
        timestamp > MAX_SAFE_INTEGER || timestamp < -MAX_SAFE_INTEGER) return NULL;
    obj=json_object(); if (!obj) return NULL;
    if (!add_value(obj,"path",json_stringn((const char *)(path ? path : (const uint8_t *)""),path_len)) ||
        !add_value(obj,"detail",json_stringn((const char *)(detail ? detail : (const uint8_t *)""),detail_len)) ||
        !add_value(obj,"nonce",json_integer((json_int_t)nonce)) ||
        !add_value(obj,"timestamp",json_integer((json_int_t)timestamp)) ||
        !add_value(obj,"signature",json_null())) { json_decref(obj); return NULL; }
    return obj;
}
static char *encode_b64(const uint8_t *data, size_t len) {
    size_t n; char *out;
    if (!data || len > (size_t)(INT_MAX/4)*3) return NULL;
    n=4*((len+2)/3); out=malloc(n+1);
    if (!out) return NULL;
    if (EVP_EncodeBlock((uint8_t *)out,data,(int)len)!=(int)n) { free(out); return NULL; }
    return out;
}
static int decode_b64(const char *text, uint8_t **out, size_t *len) {
    size_t n, padding=0; int result; char *canonical=NULL; uint8_t *buf=NULL; int ok=0;
    if (!text || !out || !len) return 0;
    *out=NULL; *len=0; n=strlen(text);
    if (!n || n%4 || n>INT_MAX) return 0;
    if (text[n-1]=='=') padding++;
    if (text[n-2]=='=') padding++;
    buf=malloc(n/4*3); if (!buf) return 0;
    result=EVP_DecodeBlock(buf,(const uint8_t *)text,(int)n);
    if (result<0 || (size_t)result<padding) goto done;
    *len=(size_t)result-padding; canonical=encode_b64(buf,*len);
    if (!canonical || strcmp(canonical,text)!=0) goto done;
    *out=buf; buf=NULL; ok=1;
done:
    free(canonical); free(buf); if (!ok) *len=0; return ok;
}
static int nibble(uint8_t c) {
    if (c>='0' && c<='9') return c-'0';
    if (c>='a' && c<='f') return c-'a'+10;
    if (c>='A' && c<='F') return c-'A'+10;
    return -1;
}
int ebp_detail_proof_create(const ebp_identity *id, const uint8_t *path, size_t path_len,
                            const uint8_t *detail, size_t detail_len, uint64_t nonce, int64_t timestamp,
                            uint8_t **proof, size_t *proof_len) {
    static const char hex[]="0123456789abcdef";
    json_t *obj=NULL; char *unsigned_json=NULL,*signature64=NULL,*signed_json=NULL;
    uint8_t *signature=NULL,*encoded=NULL; size_t signature_len=0,n; int ok=0;
    if (!proof || !proof_len) return 0;
    *proof=NULL; *proof_len=0;
    obj=unsigned_proof(path,path_len,detail,detail_len,nonce,timestamp);
    if (!obj || !(unsigned_json=js_canonical_dump(obj)) ||
        !ebp_identity_sign(id,EBP_DETAIL_PROOF,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,&signature,&signature_len) ||
        !(signature64=encode_b64(signature,signature_len)) || !add_value(obj,"signature",json_string(signature64)) ||
        !(signed_json=js_canonical_dump(obj))) goto done;
    n=strlen(signed_json); if (n>SIZE_MAX/2 || !(encoded=malloc(n*2))) goto done;
    for (size_t i=0; i<n; i++) { encoded[2*i]=hex[(uint8_t)signed_json[i]>>4]; encoded[2*i+1]=hex[(uint8_t)signed_json[i]&15]; }
    *proof=encoded; *proof_len=n*2; encoded=NULL; ok=1;
done:
    if (unsigned_json) ebp_secure_free(unsigned_json,strlen(unsigned_json));
    if (signed_json) ebp_secure_free(signed_json,strlen(signed_json));
    free(signature64); free(signature); free(encoded); json_decref(obj); return ok;
}
int ebp_detail_proof_verify(int alg, const uint8_t *pub, size_t pub_len,
                            const uint8_t *path, size_t path_len, const uint8_t *detail, size_t detail_len,
                            const uint8_t *proof, size_t proof_len, uint64_t *nonce, int64_t *timestamp) {
    uint8_t *decoded=NULL,*sig=NULL,*envelope=NULL; size_t json_len,sig_len=0,envelope_len=0;
    json_t *record=NULL,*canonical=NULL,*vpath,*vdetail,*vnonce,*vtime; json_error_t error;
    char *text=NULL; const char *sig64; int ok=0;
    if ((!path && path_len) || (!detail && detail_len) || !proof || !proof_len || proof_len%2) return 0;
    json_len=proof_len/2; decoded=malloc(json_len); if (!decoded) return 0;
    for (size_t i=0; i<json_len; i++) {
        int hi=nibble(proof[2*i]), lo=nibble(proof[2*i+1]);
        if (hi<0 || lo<0) goto done;
        decoded[i]=(uint8_t)((hi<<4)|lo);
    }
    record=json_loadb((const char *)decoded,json_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(record)) goto done;
    vpath=json_object_get(record,"path"); vdetail=json_object_get(record,"detail");
    vnonce=json_object_get(record,"nonce"); vtime=json_object_get(record,"timestamp");
    if (!json_is_string(vpath) || !json_is_string(vdetail) ||
        json_string_length(vpath)!=path_len || json_string_length(vdetail)!=detail_len ||
        (path_len && memcmp(json_string_value(vpath),path,path_len)!=0) ||
        (detail_len && memcmp(json_string_value(vdetail),detail,detail_len)!=0) ||
        !json_is_integer(vnonce) || json_integer_value(vnonce)<0 || json_integer_value(vnonce)>MAX_SAFE_INTEGER ||
        !json_is_integer(vtime) || json_integer_value(vtime)>MAX_SAFE_INTEGER || json_integer_value(vtime)<-MAX_SAFE_INTEGER) goto done;
    {
        json_t *signature_value=json_object_get(record,"signature");
        sig64=json_string_value(signature_value);
        if (!sig64 || strlen(sig64)!=json_string_length(signature_value) || !decode_b64(sig64,&sig,&sig_len)) goto done;
    }
    canonical=unsigned_proof(path,path_len,detail,detail_len,(uint64_t)json_integer_value(vnonce),(int64_t)json_integer_value(vtime));
    if (!canonical || !(text=js_canonical_dump(canonical)) ||
        !ebp_message_envelope(EBP_DETAIL_PROOF,(const uint8_t *)text,strlen(text),NULL,0,&envelope,&envelope_len) ||
        !ebp_pq_verify(alg,pub,pub_len,envelope,envelope_len,sig,sig_len)) goto done;
    if (nonce) *nonce=(uint64_t)json_integer_value(vnonce);
    if (timestamp) *timestamp=(int64_t)json_integer_value(vtime);
    ok=1;
done:
    ebp_secure_free(decoded,json_len); free(sig); ebp_secure_free(envelope,envelope_len);
    if (text) ebp_secure_free(text,strlen(text));
    json_decref(canonical); json_decref(record); return ok;
}

static char *identity_fingerprint(const ebp_identity *id) {
    uint8_t *data=NULL; size_t len=0; json_error_t error; json_t *obj=NULL, *value;
    const char *fp; char *copy=NULL;
    if (!ebp_identity_public_json(id,&data,&len)) return NULL;
    obj=json_loadb((const char *)data,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    value=json_is_object(obj)?json_object_get(obj,"fingerprint"):NULL;
    fp=json_string_value(value);
    if (fp && strlen(fp)==json_string_length(value)) {
        size_t n=strlen(fp); copy=malloc(n+1); if (copy) memcpy(copy,fp,n+1);
    }
    json_decref(obj); free(data); return copy;
}
static int valid_utf16_length(const uint8_t *text, size_t len, size_t maximum) {
    size_t pos=0, units=0;
    if (!text) return len==0;
    if (len>PTRDIFF_MAX) return 0;
    while (pos<len) {
        utf8proc_int32_t cp; utf8proc_ssize_t n=utf8proc_iterate(text+pos,(utf8proc_ssize_t)(len-pos),&cp);
        if (n<=0) return 0;
        pos+=(size_t)n; units+=cp>0xffff?2:1;
        if (units>maximum) return 0;
    }
    return 1;
}
static json_t *unsigned_revocation(int type, const char *fingerprint, uint64_t nonce, int64_t timestamp,
                                   const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len) {
    json_t *obj;
    if ((type!=1 && type!=2) || !fingerprint || nonce>MAX_SAFE_INTEGER || timestamp>MAX_SAFE_INTEGER ||
        timestamp<-MAX_SAFE_INTEGER || (!reason && reason_len) || (!target && target_len) ||
        (type==1 && !target) || !valid_utf16_length(reason,reason_len,1024)) return NULL;
    obj=json_object(); if (!obj) return NULL;
    if (!add_value(obj,"type",json_string(type==1?"detail":"identity")) ||
        !add_value(obj,"fingerprint",json_string(fingerprint)) ||
        !add_value(obj,"nonce",json_integer((json_int_t)nonce)) ||
        !add_value(obj,"timestamp",json_integer((json_int_t)timestamp)) ||
        !add_value(obj,"signature",json_null()) ||
        (reason && !add_value(obj,"reason",json_stringn((const char *)reason,reason_len))) ||
        (target && !add_value(obj,"target",json_stringn((const char *)target,target_len)))) {
        json_decref(obj); return NULL;
    }
    return obj;
}
int ebp_revocation_create(const ebp_identity *id, int type, uint64_t nonce, int64_t timestamp,
                          const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len,
                          uint8_t **out, size_t *out_len) {
    static const char hex[]="0123456789abcdef";
    char *fp=NULL,*unsigned_json=NULL,*sig64=NULL,*signed_json=NULL;
    json_t *obj=NULL; uint8_t *signature=NULL,*encoded=NULL; size_t signature_len=0,n; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    fp=identity_fingerprint(id);
    obj=unsigned_revocation(type,fp,nonce,timestamp,reason,reason_len,target,target_len);
    if (!obj || !(unsigned_json=js_canonical_dump(obj)) ||
        !ebp_identity_sign(id,EBP_REVOCATION,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,&signature,&signature_len) ||
        !(sig64=encode_b64(signature,signature_len)) || !add_value(obj,"signature",json_string(sig64)) ||
        !(signed_json=js_canonical_dump(obj))) goto done;
    n=strlen(signed_json); if (n>SIZE_MAX/2 || !(encoded=malloc(n*2))) goto done;
    for (size_t i=0; i<n; i++) { encoded[2*i]=hex[(uint8_t)signed_json[i]>>4]; encoded[2*i+1]=hex[(uint8_t)signed_json[i]&15]; }
    *out=encoded; *out_len=n*2; encoded=NULL; ok=1;
done:
    free(fp); free(signature); free(sig64); free(encoded);
    if (unsigned_json) ebp_secure_free(unsigned_json,strlen(unsigned_json));
    if (signed_json) ebp_secure_free(signed_json,strlen(signed_json));
    json_decref(obj); return ok;
}
int ebp_revocation_verify(const ebp_identity *id, const uint8_t *encoded, size_t len,
                          int expected_type, const uint8_t *expected_target, size_t expected_target_len) {
    uint8_t *json_bytes=NULL,*sig=NULL; size_t json_len,sig_len=0;
    json_t *record=NULL,*canonical=NULL,*type_value,*fp_value,*nonce_value,*time_value,*reason_value,*target_value,*sig_value;
    json_error_t error; char *fp=NULL,*unsigned_json=NULL; const char *type,*cert_fp,*signature;
    int kind,ok=0;
    if (!id || !encoded || !len || len%2 || expected_type<0 || expected_type>2 || (!expected_target && expected_target_len)) return 0;
    json_len=len/2; json_bytes=malloc(json_len); if (!json_bytes) return 0;
    for (size_t i=0; i<json_len; i++) {
        int hi=nibble(encoded[2*i]),lo=nibble(encoded[2*i+1]);
        if (hi<0 || lo<0) goto done;
        json_bytes[i]=(uint8_t)((hi<<4)|lo);
    }
    record=json_loadb((const char *)json_bytes,json_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(record)) goto done;
    type_value=json_object_get(record,"type"); fp_value=json_object_get(record,"fingerprint");
    nonce_value=json_object_get(record,"nonce"); time_value=json_object_get(record,"timestamp");
    reason_value=json_object_get(record,"reason"); target_value=json_object_get(record,"target"); sig_value=json_object_get(record,"signature");
    type=json_string_value(type_value); cert_fp=json_string_value(fp_value); signature=json_string_value(sig_value);
    if (!type || strlen(type)!=json_string_length(type_value) || !cert_fp || strlen(cert_fp)!=json_string_length(fp_value) ||
        !signature || strlen(signature)!=json_string_length(sig_value) || !json_is_integer(nonce_value) ||
        json_integer_value(nonce_value)<0 || json_integer_value(nonce_value)>MAX_SAFE_INTEGER ||
        !json_is_integer(time_value) || json_integer_value(time_value)>MAX_SAFE_INTEGER || json_integer_value(time_value)<-MAX_SAFE_INTEGER ||
        (reason_value && !json_is_string(reason_value)) || (target_value && !json_is_string(target_value))) goto done;
    kind=strcmp(type,"detail")==0?1:strcmp(type,"identity")==0?2:0;
    if (!kind || (expected_type && expected_type!=kind) || (kind==1 && !json_is_string(target_value)) ||
        !(fp=identity_fingerprint(id)) || strcmp(fp,cert_fp)!=0) goto done;
    if (expected_target && (!json_is_string(target_value) || json_string_length(target_value)!=expected_target_len ||
        memcmp(json_string_value(target_value),expected_target,expected_target_len)!=0)) goto done;
    canonical=unsigned_revocation(kind,cert_fp,(uint64_t)json_integer_value(nonce_value),(int64_t)json_integer_value(time_value),
        reason_value?(const uint8_t *)json_string_value(reason_value):NULL,reason_value?json_string_length(reason_value):0,
        target_value?(const uint8_t *)json_string_value(target_value):NULL,target_value?json_string_length(target_value):0);
    if (!canonical || !(unsigned_json=js_canonical_dump(canonical)) ||
        !decode_b64(signature,&sig,&sig_len) ||
        !ebp_identity_verify(id,EBP_REVOCATION,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,sig,sig_len)) goto done;
    ok=1;
done:
    free(fp); free(sig); if (unsigned_json) ebp_secure_free(unsigned_json,strlen(unsigned_json));
    ebp_secure_free(json_bytes,json_len); json_decref(record); json_decref(canonical); return ok;
}

static json_t *hierarchy_payload(const char *master, const char *child, uint64_t timestamp, uint64_t expiry,
                                 const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len) {
    json_t *obj;
    if (!master || !child || strcmp(master,child)==0 || timestamp>MAX_SAFE_INTEGER || expiry>MAX_SAFE_INTEGER ||
        (!context && context_len) || !salt || !salt_len || !valid_utf16_length(context,context_len,256)) return NULL;
    obj=json_object(); if (!obj) return NULL;
    if (!add_value(obj,"type",json_string("HierarchyCertificate")) ||
        !add_value(obj,"masterFingerprint",json_string(master)) || !add_value(obj,"childFingerprint",json_string(child)) ||
        !add_value(obj,"timestamp",json_integer((json_int_t)timestamp)) || !add_value(obj,"expiry",json_integer((json_int_t)expiry)) ||
        !add_value(obj,"context",json_stringn((const char *)(context?context:(const uint8_t *)""),context_len)) ||
        !add_value(obj,"salt",json_stringn((const char *)salt,salt_len))) { json_decref(obj); return NULL; }
    return obj;
}
int ebp_hierarchy_create(const ebp_identity *master, const ebp_identity *child, uint64_t timestamp, uint64_t expiry,
                         const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len,
                         uint8_t **out, size_t *out_len) {
    static const char hex[]="0123456789abcdef";
    char *master_fp=NULL,*child_fp=NULL,*unsigned_json=NULL,*master64=NULL,*child64=NULL,*signed_json=NULL;
    uint8_t *master_sig=NULL,*child_sig=NULL,*encoded=NULL; size_t master_len=0,child_len=0,n;
    json_t *obj=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    master_fp=identity_fingerprint(master); child_fp=identity_fingerprint(child);
    obj=hierarchy_payload(master_fp,child_fp,timestamp,expiry,context,context_len,salt,salt_len);
    if (!obj || !(unsigned_json=js_canonical_dump(obj)) ||
        !ebp_identity_sign(master,EBP_HIERARCHY,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,&master_sig,&master_len) ||
        !ebp_identity_sign(child,EBP_HIERARCHY,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,&child_sig,&child_len) ||
        !(master64=encode_b64(master_sig,master_len)) || !(child64=encode_b64(child_sig,child_len)) ||
        json_object_del(obj,"type")!=0 || !add_value(obj,"masterSignature",json_string(master64)) ||
        !add_value(obj,"childSignature",json_string(child64)) || !(signed_json=js_canonical_dump(obj))) goto done;
    n=strlen(signed_json); if (n>SIZE_MAX/2 || !(encoded=malloc(n*2))) goto done;
    for (size_t i=0; i<n; i++) { encoded[2*i]=hex[(uint8_t)signed_json[i]>>4]; encoded[2*i+1]=hex[(uint8_t)signed_json[i]&15]; }
    *out=encoded; *out_len=n*2; encoded=NULL; ok=1;
done:
    free(master_fp); free(child_fp); free(master_sig); free(child_sig); free(master64); free(child64); free(encoded);
    if (unsigned_json) ebp_secure_free(unsigned_json,strlen(unsigned_json));
    if (signed_json) ebp_secure_free(signed_json,strlen(signed_json));
    json_decref(obj); return ok;
}
int ebp_hierarchy_verify(const ebp_identity *master, const ebp_identity *child, const uint8_t *encoded, size_t len) {
    uint8_t *json_bytes=NULL,*master_sig=NULL,*child_sig=NULL; size_t json_len,master_len=0,child_len=0;
    json_t *record=NULL,*payload=NULL,*mfp,*cfp,*time,*expiry,*context,*salt,*msig,*csig; json_error_t error;
    char *master_fp=NULL,*child_fp=NULL,*unsigned_json=NULL; const char *m,*c,*m64,*c64; int ok=0;
    if (!master || !child || !encoded || !len || len%2) return 0;
    json_len=len/2; json_bytes=malloc(json_len); if (!json_bytes) return 0;
    for (size_t i=0; i<json_len; i++) {
        int hi=nibble(encoded[2*i]),lo=nibble(encoded[2*i+1]); if (hi<0 || lo<0) goto done;
        json_bytes[i]=(uint8_t)((hi<<4)|lo);
    }
    record=json_loadb((const char *)json_bytes,json_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(record)) goto done;
    mfp=json_object_get(record,"masterFingerprint"); cfp=json_object_get(record,"childFingerprint");
    time=json_object_get(record,"timestamp"); expiry=json_object_get(record,"expiry");
    context=json_object_get(record,"context"); salt=json_object_get(record,"salt");
    msig=json_object_get(record,"masterSignature"); csig=json_object_get(record,"childSignature");
    m=json_string_value(mfp); c=json_string_value(cfp); m64=json_string_value(msig); c64=json_string_value(csig);
    if (!m || strlen(m)!=json_string_length(mfp) || !c || strlen(c)!=json_string_length(cfp) ||
        !m64 || strlen(m64)!=json_string_length(msig) || !c64 || strlen(c64)!=json_string_length(csig) ||
        !json_is_integer(time) || json_integer_value(time)<0 || json_integer_value(time)>MAX_SAFE_INTEGER ||
        !json_is_integer(expiry) || json_integer_value(expiry)<0 || json_integer_value(expiry)>MAX_SAFE_INTEGER ||
        !json_is_string(context) || !json_is_string(salt) || !(master_fp=identity_fingerprint(master)) ||
        !(child_fp=identity_fingerprint(child)) || strcmp(m,master_fp)!=0 || strcmp(c,child_fp)!=0) goto done;
    payload=hierarchy_payload(m,c,(uint64_t)json_integer_value(time),(uint64_t)json_integer_value(expiry),
        (const uint8_t *)json_string_value(context),json_string_length(context),
        (const uint8_t *)json_string_value(salt),json_string_length(salt));
    if (!payload || !(unsigned_json=js_canonical_dump(payload)) ||
        !decode_b64(m64,&master_sig,&master_len) || !decode_b64(c64,&child_sig,&child_len) ||
        !ebp_identity_verify(master,EBP_HIERARCHY,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,master_sig,master_len) ||
        !ebp_identity_verify(child,EBP_HIERARCHY,(const uint8_t *)unsigned_json,strlen(unsigned_json),NULL,0,child_sig,child_len)) goto done;
    ok=1;
done:
    free(master_fp); free(child_fp); free(master_sig); free(child_sig);
    if (unsigned_json) ebp_secure_free(unsigned_json,strlen(unsigned_json));
    ebp_secure_free(json_bytes,json_len); json_decref(record); json_decref(payload); return ok;
}

int ebp_hierarchy_expired(uint64_t expiry, uint64_t now) { return expiry != 0 && expiry <= now; }
static const char *find_parent(const ebp_hierarchy_edge *edges, size_t count, const char *child) {
    for (size_t i=0; i<count; i++) if (strcmp(edges[i].child_fingerprint,child)==0) return edges[i].master_fingerprint;
    return NULL;
}
int ebp_hierarchy_validate(const ebp_hierarchy_edge *edges, size_t count, const ebp_hierarchy_edge *proposed) {
    const char *current;
    if (!edges && count) return 0;
    for (size_t i=0; i<count; i++) {
        if (!edges[i].master_fingerprint || !edges[i].child_fingerprint ||
            strcmp(edges[i].master_fingerprint,edges[i].child_fingerprint)==0) return 0;
        for (size_t j=0; j<i; j++) if (strcmp(edges[i].child_fingerprint,edges[j].child_fingerprint)==0) return 0;
    }
    if (proposed) {
        if (!proposed->master_fingerprint || !proposed->child_fingerprint ||
            strcmp(proposed->master_fingerprint,proposed->child_fingerprint)==0 ||
            find_parent(edges,count,proposed->child_fingerprint)) return 0;
        current=proposed->master_fingerprint;
        for (size_t steps=0; current && *current; steps++) {
            if (strcmp(current,proposed->child_fingerprint)==0 || steps>count) return 0;
            current=find_parent(edges,count,current);
        }
        return 1;
    }
    for (size_t i=0; i<count; i++) {
        current=edges[i].child_fingerprint;
        for (size_t steps=0; current && *current; steps++) {
            if (steps>count) return 0;
            current=find_parent(edges,count,current);
        }
    }
    return 1;
}
