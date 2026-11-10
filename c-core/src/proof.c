#include "ebp_core.h"
#include "json_compat.h"
#include "jcs.h"
#include <jansson.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <utf8proc.h>

#define MAX_SAFE_INTEGER INT64_C(9007199254740991)
static char *js_canonical_dump(const json_t *value) {
    return ebp_jcs_dump(value);
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
    if (!add_value(obj,"version",json_integer(2)) || !add_value(obj,"path",json_stringn((const char *)(path ? path : (const uint8_t *)""),path_len)) ||
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
    if (!json_is_object(record) || !ebp_json_is_safe_integer(json_object_get(record,"version")) || ebp_json_safe_integer(json_object_get(record,"version"))!=2) goto done;
    vpath=json_object_get(record,"path"); vdetail=json_object_get(record,"detail");
    vnonce=json_object_get(record,"nonce"); vtime=json_object_get(record,"timestamp");
    if (!json_is_string(vpath) || !json_is_string(vdetail) ||
        json_string_length(vpath)!=path_len || json_string_length(vdetail)!=detail_len ||
        (path_len && memcmp(json_string_value(vpath),path,path_len)!=0) ||
        (detail_len && memcmp(json_string_value(vdetail),detail,detail_len)!=0) ||
        !ebp_json_is_safe_integer(vnonce) || ebp_json_safe_integer(vnonce)<0 || ebp_json_safe_integer(vnonce)>MAX_SAFE_INTEGER ||
        !ebp_json_is_safe_integer(vtime) || ebp_json_safe_integer(vtime)>MAX_SAFE_INTEGER || ebp_json_safe_integer(vtime)<-MAX_SAFE_INTEGER) goto done;
    {
        json_t *signature_value=json_object_get(record,"signature");
        sig64=json_string_value(signature_value);
        if (!sig64 || strlen(sig64)!=json_string_length(signature_value) || !decode_b64(sig64,&sig,&sig_len)) goto done;
    }
    canonical=unsigned_proof(path,path_len,detail,detail_len,(uint64_t)ebp_json_safe_integer(vnonce),(int64_t)ebp_json_safe_integer(vtime));
    if (!canonical || !(text=js_canonical_dump(canonical)) ||
        !ebp_message_envelope(EBP_DETAIL_PROOF,(const uint8_t *)text,strlen(text),NULL,0,&envelope,&envelope_len) ||
        !ebp_pq_verify(alg,pub,pub_len,envelope,envelope_len,sig,sig_len)) goto done;
    if (nonce) *nonce=(uint64_t)ebp_json_safe_integer(vnonce);
    if (timestamp) *timestamp=(int64_t)ebp_json_safe_integer(vtime);
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
    if (!add_value(obj,"version",json_integer(2)) || !add_value(obj,"type",json_string(type==1?"detail":"identity")) ||
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
    if (!json_is_object(record) || !ebp_json_is_safe_integer(json_object_get(record,"version")) || ebp_json_safe_integer(json_object_get(record,"version"))!=2) goto done;
    type_value=json_object_get(record,"type"); fp_value=json_object_get(record,"fingerprint");
    nonce_value=json_object_get(record,"nonce"); time_value=json_object_get(record,"timestamp");
    reason_value=json_object_get(record,"reason"); target_value=json_object_get(record,"target"); sig_value=json_object_get(record,"signature");
    type=json_string_value(type_value); cert_fp=json_string_value(fp_value); signature=json_string_value(sig_value);
    if (!type || strlen(type)!=json_string_length(type_value) || !cert_fp || strlen(cert_fp)!=json_string_length(fp_value) ||
        !signature || strlen(signature)!=json_string_length(sig_value) || !ebp_json_is_safe_integer(nonce_value) ||
        ebp_json_safe_integer(nonce_value)<0 || ebp_json_safe_integer(nonce_value)>MAX_SAFE_INTEGER ||
        !ebp_json_is_safe_integer(time_value) || ebp_json_safe_integer(time_value)>MAX_SAFE_INTEGER || ebp_json_safe_integer(time_value)<-MAX_SAFE_INTEGER ||
        (reason_value && !json_is_string(reason_value)) || (target_value && !json_is_string(target_value))) goto done;
    kind=strcmp(type,"detail")==0?1:strcmp(type,"identity")==0?2:0;
    if (!kind || (expected_type && expected_type!=kind) || (kind==1 && !json_is_string(target_value)) ||
        !(fp=identity_fingerprint(id)) || strcmp(fp,cert_fp)!=0) goto done;
    if (expected_target && (!json_is_string(target_value) || json_string_length(target_value)!=expected_target_len ||
        memcmp(json_string_value(target_value),expected_target,expected_target_len)!=0)) goto done;
    canonical=unsigned_revocation(kind,cert_fp,(uint64_t)ebp_json_safe_integer(nonce_value),(int64_t)ebp_json_safe_integer(time_value),
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
    if (!add_value(obj,"version",json_integer(2)) || !add_value(obj,"type",json_string("HierarchyCertificate")) ||
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
    if (!json_is_object(record) || !ebp_json_is_safe_integer(json_object_get(record,"version")) || ebp_json_safe_integer(json_object_get(record,"version"))!=2) goto done;
    mfp=json_object_get(record,"masterFingerprint"); cfp=json_object_get(record,"childFingerprint");
    time=json_object_get(record,"timestamp"); expiry=json_object_get(record,"expiry");
    context=json_object_get(record,"context"); salt=json_object_get(record,"salt");
    msig=json_object_get(record,"masterSignature"); csig=json_object_get(record,"childSignature");
    m=json_string_value(mfp); c=json_string_value(cfp); m64=json_string_value(msig); c64=json_string_value(csig);
    if (!m || strlen(m)!=json_string_length(mfp) || !c || strlen(c)!=json_string_length(cfp) ||
        !m64 || strlen(m64)!=json_string_length(msig) || !c64 || strlen(c64)!=json_string_length(csig) ||
        !ebp_json_is_safe_integer(time) || ebp_json_safe_integer(time)<0 || ebp_json_safe_integer(time)>MAX_SAFE_INTEGER ||
        !ebp_json_is_safe_integer(expiry) || ebp_json_safe_integer(expiry)<0 || ebp_json_safe_integer(expiry)>MAX_SAFE_INTEGER ||
        !json_is_string(context) || !json_is_string(salt) || !(master_fp=identity_fingerprint(master)) ||
        !(child_fp=identity_fingerprint(child)) || strcmp(m,master_fp)!=0 || strcmp(c,child_fp)!=0) goto done;
    payload=hierarchy_payload(m,c,(uint64_t)ebp_json_safe_integer(time),(uint64_t)ebp_json_safe_integer(expiry),
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

static json_t *hierarchy_payload_from_record(const json_t *record) {
    const json_t *m,*c,*t,*e,*ctx,*salt,*version; const char *master,*child;
    if (!json_is_object(record)) return NULL;
    version=json_object_get(record,"version"); m=json_object_get(record,"masterFingerprint"); c=json_object_get(record,"childFingerprint");
    t=json_object_get(record,"timestamp"); e=json_object_get(record,"expiry"); ctx=json_object_get(record,"context"); salt=json_object_get(record,"salt");
    master=json_string_value(m); child=json_string_value(c);
    if (!ebp_json_is_safe_integer(version) || ebp_json_safe_integer(version)!=2 || !master || !*master || strlen(master)!=json_string_length(m) ||
        !child || !*child || strlen(child)!=json_string_length(c) || !ebp_json_is_safe_integer(t) || ebp_json_safe_integer(t)<0 ||
        !ebp_json_is_safe_integer(e) || ebp_json_safe_integer(e)<0 || !json_is_string(ctx) || !json_is_string(salt)) return NULL;
    return hierarchy_payload(master,child,(uint64_t)ebp_json_safe_integer(t),(uint64_t)ebp_json_safe_integer(e),
                             (const uint8_t *)json_string_value(ctx),json_string_length(ctx),
                             (const uint8_t *)json_string_value(salt),json_string_length(salt));
}
static json_t *parse_hierarchy_record(const uint8_t *data, size_t len, int require_signatures) {
    json_error_t error; json_t *record,*payload,*a,*b;
    if (!data || !len || !(record=json_loadb((const char *)data,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error))) return NULL;
    payload=hierarchy_payload_from_record(record);
    if (!payload) { json_decref(record); return NULL; }
    json_decref(payload);
    a=json_object_get(record,"masterSignature"); b=json_object_get(record,"childSignature");
    if (!a || !b || (require_signatures && (!json_is_string(a) || !json_string_length(a) || !json_is_string(b) || !json_string_length(b))) ||
        (!require_signatures && ((!json_is_null(a) && !json_is_string(a)) || (!json_is_null(b) && !json_is_string(b))))) {
        json_decref(record); return NULL;
    }
    return record;
}
int ebp_hierarchy_unsigned(const char *master, const char *child, uint64_t timestamp, uint64_t expiry,
                           const uint8_t *context, size_t context_len, const uint8_t *salt, size_t salt_len,
                           uint8_t **out, size_t *out_len) {
    json_t *obj=NULL; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!master || !*master || !child || !*child || !(obj=hierarchy_payload(master,child,timestamp,expiry,context,context_len,salt,salt_len)) ||
        json_object_del(obj,"type")!=0 || !add_value(obj,"masterSignature",json_null()) || !add_value(obj,"childSignature",json_null()) ||
        !(text=ebp_jcs_dump(obj))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(obj); return ok;
}
int ebp_hierarchy_signature_payload(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    json_t *record=NULL,*payload=NULL; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!(record=parse_hierarchy_record(data,len,0)) || !(payload=hierarchy_payload_from_record(record)) || !(text=ebp_jcs_dump(payload))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(record); json_decref(payload); return ok;
}
int ebp_hierarchy_sign_part(const ebp_identity *signer, int is_child, const uint8_t *data, size_t len,
                            uint8_t **out, size_t *out_len) {
    json_t *record=NULL,*payload=NULL; char *fp=NULL,*text=NULL,*signature64=NULL,*signed_text=NULL;
    uint8_t *signature=NULL; size_t sig_len=0; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!signer || (is_child!=0 && is_child!=1) || !(record=parse_hierarchy_record(data,len,0)) ||
        !(fp=identity_fingerprint(signer)) || strcmp(fp,json_string_value(json_object_get(record,is_child?"childFingerprint":"masterFingerprint")))!=0 ||
        !(payload=hierarchy_payload_from_record(record)) || !(text=ebp_jcs_dump(payload)) ||
        !ebp_identity_sign(signer,EBP_HIERARCHY,(const uint8_t *)text,strlen(text),NULL,0,&signature,&sig_len) ||
        !(signature64=encode_b64(signature,sig_len)) ||
        !add_value(record,is_child?"childSignature":"masterSignature",json_string(signature64)) || !(signed_text=ebp_jcs_dump(record))) goto done;
    *out=(uint8_t *)signed_text; *out_len=strlen(signed_text); signed_text=NULL; ok=1;
done:
    free(fp); free(text); free(signature); free(signature64); free(signed_text); json_decref(payload); json_decref(record); return ok;
}
int ebp_hierarchy_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    static const char hex[]="0123456789abcdef"; json_t *record=NULL; char *text=NULL; uint8_t *encoded=NULL; size_t n; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!(record=parse_hierarchy_record(data,len,0)) || !(text=ebp_jcs_dump(record))) goto done;
    n=strlen(text); if (n>SIZE_MAX/2 || !(encoded=malloc(n*2))) goto done;
    for (size_t i=0;i<n;i++) { encoded[2*i]=hex[(uint8_t)text[i]>>4]; encoded[2*i+1]=hex[(uint8_t)text[i]&15]; }
    *out=encoded; *out_len=n*2; encoded=NULL; ok=1;
done:
    free(encoded); free(text); json_decref(record); return ok;
}
static int hierarchy_decode(const uint8_t *hex, size_t len, int require_signatures, uint8_t **out, size_t *out_len) {
    uint8_t *raw=NULL; size_t n; json_t *record=NULL; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!hex || !len || len%2 || !(raw=malloc(len/2))) return 0;
    n=len/2;
    for (size_t i=0;i<n;i++) { int a=nibble(hex[2*i]),b=nibble(hex[2*i+1]); if (a<0 || b<0) goto done; raw[i]=(uint8_t)((a<<4)|b); }
    if (!(record=parse_hierarchy_record(raw,n,require_signatures)) || !(text=ebp_jcs_dump(record))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(raw); free(text); json_decref(record); return ok;
}
int ebp_hierarchy_decode(const uint8_t *hex, size_t len, uint8_t **out, size_t *out_len) {
    return hierarchy_decode(hex,len,1,out,out_len);
}
int ebp_hierarchy_decode_draft(const uint8_t *hex, size_t len, uint8_t **out, size_t *out_len) {
    return hierarchy_decode(hex,len,0,out,out_len);
}

static json_t *revocation_payload_from_record(const json_t *record) {
    const json_t *v,*t,*f,*n,*time,*reason,*target; const char *kind,*fp; int type;
    if (!json_is_object(record)) return NULL;
    v=json_object_get(record,"version"); t=json_object_get(record,"type"); f=json_object_get(record,"fingerprint");
    n=json_object_get(record,"nonce"); time=json_object_get(record,"timestamp"); reason=json_object_get(record,"reason"); target=json_object_get(record,"target");
    kind=json_string_value(t); fp=json_string_value(f);
    if (!ebp_json_is_safe_integer(v) || ebp_json_safe_integer(v)!=2 || !kind || strlen(kind)!=json_string_length(t) || !fp || !*fp || strlen(fp)!=json_string_length(f) ||
        !ebp_json_is_safe_integer(n) || ebp_json_safe_integer(n)<0 || !ebp_json_is_safe_integer(time) ||
        (reason && !json_is_string(reason)) || (target && !json_is_string(target))) return NULL;
    type=!strcmp(kind,"detail")?1:!strcmp(kind,"identity")?2:0;
    return unsigned_revocation(type,fp,(uint64_t)ebp_json_safe_integer(n),(int64_t)ebp_json_safe_integer(time),
        reason?(const uint8_t *)json_string_value(reason):NULL,reason?json_string_length(reason):0,
        target?(const uint8_t *)json_string_value(target):NULL,target?json_string_length(target):0);
}
static json_t *parse_revocation_record(const uint8_t *data, size_t len, int require_signature) {
    json_error_t error; json_t *record,*payload,*signature;
    if (!data || !len || !(record=json_loadb((const char *)data,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error))) return NULL;
    payload=revocation_payload_from_record(record);
    signature=json_object_get(record,"signature");
    if (!payload || !signature || (require_signature ? !json_is_string(signature) || !json_string_length(signature) : !json_is_null(signature) && !json_is_string(signature))) {
        json_decref(payload); json_decref(record); return NULL;
    }
    json_decref(payload); return record;
}
int ebp_revocation_unsigned(int type, const char *fingerprint, uint64_t nonce, int64_t timestamp,
                            const uint8_t *reason, size_t reason_len, const uint8_t *target, size_t target_len,
                            uint8_t **out, size_t *out_len) {
    json_t *record; char *text;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!fingerprint || !*fingerprint || !(record=unsigned_revocation(type,fingerprint,nonce,timestamp,reason,reason_len,target,target_len))) return 0;
    text=ebp_jcs_dump(record); json_decref(record); if (!text) return 0;
    *out=(uint8_t *)text; *out_len=strlen(text); return 1;
}
int ebp_revocation_signature_payload(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    json_t *record,*payload; char *text;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!(record=parse_revocation_record(data,len,0))) return 0;
    payload=revocation_payload_from_record(record); json_decref(record);
    text=payload?ebp_jcs_dump(payload):NULL; json_decref(payload); if (!text) return 0;
    *out=(uint8_t *)text; *out_len=strlen(text); return 1;
}
int ebp_revocation_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    static const char alphabet[]="0123456789abcdef"; json_t *record; char *text; uint8_t *encoded; size_t n;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!(record=parse_revocation_record(data,len,1))) return 0;
    text=ebp_jcs_dump(record); json_decref(record); if (!text) return 0;
    n=strlen(text); if (n>SIZE_MAX/2 || !(encoded=malloc(n*2))) { free(text); return 0; }
    for (size_t i=0;i<n;i++) { encoded[2*i]=alphabet[(uint8_t)text[i]>>4]; encoded[2*i+1]=alphabet[(uint8_t)text[i]&15]; }
    free(text); *out=encoded; *out_len=n*2; return 1;
}
int ebp_revocation_decode(const uint8_t *hex, size_t len, uint8_t **out, size_t *out_len) {
    uint8_t *raw; json_t *record=NULL; char *text=NULL; size_t n; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!hex || !len || len%2 || !(raw=malloc(len/2))) return 0;
    n=len/2;
    for (size_t i=0;i<n;i++) { int a=nibble(hex[2*i]),b=nibble(hex[2*i+1]); if (a<0 || b<0) goto done; raw[i]=(uint8_t)((a<<4)|b); }
    if (!(record=parse_revocation_record(raw,n,1)) || !(text=ebp_jcs_dump(record))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(raw); free(text); json_decref(record); return ok;
}

const char *ebp_verify_status_message(int status) {
    static const char *messages[]={"ok","invalid certificate encoding","unsupported version","identity or field mismatch",
        "invalid nonce","invalid timestamp","missing signature","invalid signature","invalid type","invalid reason","invalid target",
        "invalid master signature","invalid child signature","hierarchy contains self-parenting", "child already has a master",
        "hierarchy contains a loop", "invalid hierarchy edge"};
    return status>=0 && (size_t)status<sizeof(messages)/sizeof(messages[0])?messages[status]:"unknown verification error";
}
int ebp_hierarchy_validate_ex(const ebp_hierarchy_edge *edges, size_t count, const ebp_hierarchy_edge *proposed) {
    if (ebp_hierarchy_validate(edges,count,proposed)) return EBP_VERIFY_OK;
    if (!edges && count) return EBP_VERIFY_HIERARCHY_INVALID_EDGE;
    for (size_t i=0;i<count;i++) {
        if (!edges[i].master_fingerprint || !edges[i].child_fingerprint) return EBP_VERIFY_HIERARCHY_INVALID_EDGE;
        if (!strcmp(edges[i].master_fingerprint,edges[i].child_fingerprint)) return EBP_VERIFY_HIERARCHY_SELF;
        for (size_t j=0;j<i;j++) if (!strcmp(edges[i].child_fingerprint,edges[j].child_fingerprint)) return EBP_VERIFY_HIERARCHY_DUPLICATE;
    }
    if (proposed) {
        if (!proposed->master_fingerprint || !proposed->child_fingerprint) return EBP_VERIFY_HIERARCHY_INVALID_EDGE;
        if (!strcmp(proposed->master_fingerprint,proposed->child_fingerprint)) return EBP_VERIFY_HIERARCHY_SELF;
        if (find_parent(edges,count,proposed->child_fingerprint)) return EBP_VERIFY_HIERARCHY_DUPLICATE;
    }
    return EBP_VERIFY_HIERARCHY_LOOP;
}
static json_t *decode_hex_record(const uint8_t *hex, size_t len) {
    json_t *record; json_error_t error; uint8_t *raw;
    if (!hex || !len || len%2 || !(raw=malloc(len/2))) return NULL;
    for (size_t i=0;i<len/2;i++) { int a=nibble(hex[2*i]),b=nibble(hex[2*i+1]); if (a<0 || b<0) { free(raw); return NULL; } raw[i]=(uint8_t)((a<<4)|b); }
    record=json_loadb((const char *)raw,len/2,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error); free(raw);
    if (!json_is_object(record)) { json_decref(record); return NULL; }
    return record;
}
int ebp_detail_proof_verify_ex(int alg, const uint8_t *pub, size_t pub_len, const uint8_t *path, size_t path_len,
                               const uint8_t *detail, size_t detail_len, const uint8_t *proof, size_t proof_len,
                               uint64_t *nonce, int64_t *timestamp) {
    json_t *record=NULL,*p,*d,*n,*t,*s; int result=EBP_VERIFY_INVALID_ENCODING;
    if (ebp_detail_proof_verify(alg,pub,pub_len,path,path_len,detail,detail_len,proof,proof_len,nonce,timestamp)) return EBP_VERIFY_OK;
    if (!(record=decode_hex_record(proof,proof_len))) return result;
    if (!ebp_json_is_safe_integer(json_object_get(record,"version")) || ebp_json_safe_integer(json_object_get(record,"version"))!=2) { result=EBP_VERIFY_UNSUPPORTED_VERSION; goto done; }
    p=json_object_get(record,"path"); d=json_object_get(record,"detail"); n=json_object_get(record,"nonce"); t=json_object_get(record,"timestamp"); s=json_object_get(record,"signature");
    if ((!path && path_len) || (!detail && detail_len) || !json_is_string(p) || !json_is_string(d) || json_string_length(p)!=path_len ||
        json_string_length(d)!=detail_len || (path_len && memcmp(json_string_value(p),path,path_len)) || (detail_len && memcmp(json_string_value(d),detail,detail_len))) result=EBP_VERIFY_MISMATCH;
    else if (!ebp_json_is_safe_integer(n) || ebp_json_safe_integer(n)<0 || ebp_json_safe_integer(n)>MAX_SAFE_INTEGER) result=EBP_VERIFY_INVALID_NONCE;
    else if (!ebp_json_is_safe_integer(t) || ebp_json_safe_integer(t)<-MAX_SAFE_INTEGER || ebp_json_safe_integer(t)>MAX_SAFE_INTEGER) result=EBP_VERIFY_INVALID_TIMESTAMP;
    else if (!json_is_string(s) || !json_string_length(s)) result=EBP_VERIFY_MISSING_SIGNATURE;
    else result=EBP_VERIFY_INVALID_SIGNATURE;
done:
    json_decref(record); return result;
}
int ebp_revocation_verify_ex(const ebp_identity *id, const uint8_t *encoded, size_t len,
                             int expected_type, const uint8_t *expected_target, size_t expected_target_len) {
    json_t *record=NULL,*v,*type,*f,*n,*t,*reason,*target,*sig; const char *kind,*fp; char *own=NULL; int category=0,result=EBP_VERIFY_INVALID_ENCODING;
    if (ebp_revocation_verify(id,encoded,len,expected_type,expected_target,expected_target_len)) return EBP_VERIFY_OK;
    if (!id || !(record=decode_hex_record(encoded,len))) return result;
    v=json_object_get(record,"version"); type=json_object_get(record,"type"); f=json_object_get(record,"fingerprint");
    n=json_object_get(record,"nonce"); t=json_object_get(record,"timestamp"); reason=json_object_get(record,"reason");
    target=json_object_get(record,"target"); sig=json_object_get(record,"signature");
    kind=json_string_value(type); fp=json_string_value(f);
    if (!ebp_json_is_safe_integer(v) || ebp_json_safe_integer(v)!=2) result=EBP_VERIFY_UNSUPPORTED_VERSION;
    else if (!kind || strlen(kind)!=json_string_length(type) || !(category=!strcmp(kind,"detail")?1:!strcmp(kind,"identity")?2:0)) result=EBP_VERIFY_INVALID_TYPE;
    else if (!ebp_json_is_safe_integer(n) || ebp_json_safe_integer(n)<0 || ebp_json_safe_integer(n)>MAX_SAFE_INTEGER) result=EBP_VERIFY_INVALID_NONCE;
    else if (!ebp_json_is_safe_integer(t) || ebp_json_safe_integer(t)<-MAX_SAFE_INTEGER || ebp_json_safe_integer(t)>MAX_SAFE_INTEGER) result=EBP_VERIFY_INVALID_TIMESTAMP;
    else if (reason && (!json_is_string(reason) || !valid_utf16_length((const uint8_t *)json_string_value(reason),json_string_length(reason),1024))) result=EBP_VERIFY_INVALID_REASON;
    else if ((category==1 && !json_is_string(target)) || (target && !json_is_string(target))) result=EBP_VERIFY_INVALID_TARGET;
    else if (!json_is_string(sig) || !json_string_length(sig)) result=EBP_VERIFY_MISSING_SIGNATURE;
    else if (!fp || strlen(fp)!=json_string_length(f) || !(own=identity_fingerprint(id)) || strcmp(fp,own) || (expected_type && expected_type!=category) ||
             (expected_target && (!json_is_string(target) || json_string_length(target)!=expected_target_len || memcmp(json_string_value(target),expected_target,expected_target_len)))) result=EBP_VERIFY_MISMATCH;
    else result=EBP_VERIFY_INVALID_SIGNATURE;
    free(own); json_decref(record); return result;
}
int ebp_hierarchy_verify_ex(const ebp_identity *master, const ebp_identity *child, const uint8_t *encoded, size_t len) {
    json_t *record=NULL,*payload=NULL,*a,*b; char *m=NULL,*c=NULL,*text=NULL; uint8_t *sig=NULL; size_t sig_len=0; int result=EBP_VERIFY_INVALID_ENCODING;
    if (ebp_hierarchy_verify(master,child,encoded,len)) return EBP_VERIFY_OK;
    if (!master || !child || !(record=decode_hex_record(encoded,len))) return result;
    if (!ebp_json_is_safe_integer(json_object_get(record,"version")) || ebp_json_safe_integer(json_object_get(record,"version"))!=2) { result=EBP_VERIFY_UNSUPPORTED_VERSION; goto done; }
    payload=hierarchy_payload_from_record(record); if (!payload) goto done;
    a=json_object_get(record,"masterSignature"); b=json_object_get(record,"childSignature");
    if (!json_is_string(a) || !json_string_length(a) || !json_is_string(b) || !json_string_length(b)) { result=EBP_VERIFY_MISSING_SIGNATURE; goto done; }
    m=identity_fingerprint(master); c=identity_fingerprint(child);
    if (!m || !c || strcmp(m,json_string_value(json_object_get(record,"masterFingerprint"))) || strcmp(c,json_string_value(json_object_get(record,"childFingerprint")))) { result=EBP_VERIFY_MISMATCH; goto done; }
    text=ebp_jcs_dump(payload); if (!text) goto done;
    if (strlen(json_string_value(a))!=json_string_length(a) || !decode_b64(json_string_value(a),&sig,&sig_len) ||
        !ebp_identity_verify(master,EBP_HIERARCHY,(const uint8_t *)text,strlen(text),NULL,0,sig,sig_len)) { result=EBP_VERIFY_MASTER_SIGNATURE; goto done; }
    free(sig); sig=NULL;
    if (strlen(json_string_value(b))!=json_string_length(b) || !decode_b64(json_string_value(b),&sig,&sig_len) ||
        !ebp_identity_verify(child,EBP_HIERARCHY,(const uint8_t *)text,strlen(text),NULL,0,sig,sig_len)) { result=EBP_VERIFY_CHILD_SIGNATURE; goto done; }
    result=EBP_VERIFY_INVALID_SIGNATURE;
done:
    free(m); free(c); free(text); free(sig); json_decref(payload); json_decref(record); return result;
}
