/* RFC 8785 JSON serialization. Binary64 conversion uses the Ryu library. */
#include "ebp_core.h"
#include "json_compat.h"
#include "jcs.h"
#include "ryu/ryu.h"
#include <jansson.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <utf8proc.h>

typedef struct { char *data; size_t len, cap; } buffer;
static int append(buffer *b, const char *s, size_t n) {
    size_t cap; char *p;
    if (n>SIZE_MAX-b->len-1) return 0;
    if (b->len+n+1>b->cap) {
        cap=b->cap?b->cap:128;
        while (cap<b->len+n+1) { if (cap>SIZE_MAX/2) { cap=b->len+n+1; break; } cap*=2; }
        p=realloc(b->data,cap); if (!p) return 0;
        b->data=p; b->cap=cap;
    }
    memcpy(b->data+b->len,s,n); b->len+=n; b->data[b->len]='\0'; return 1;
}
static int literal(buffer *b, const char *s) { return append(b,s,strlen(s)); }

typedef struct { const uint8_t *s; size_t len,pos; unsigned pending; } iterator;
static int next_unit(iterator *i, unsigned *u) {
    utf8proc_int32_t cp; utf8proc_ssize_t n;
    if (i->pending) { *u=i->pending; i->pending=0; return 1; }
    if (i->pos==i->len) return 0;
    if (i->len-i->pos>PTRDIFF_MAX) return -1;
    n=utf8proc_iterate(i->s+i->pos,(utf8proc_ssize_t)(i->len-i->pos),&cp);
    if (n<=0 || (cp>=0xd800 && cp<=0xdfff)) return -1;
    i->pos+=(size_t)n;
    if (cp>0xffff) { cp-=0x10000; *u=0xd800u+((unsigned)cp>>10); i->pending=0xdc00u+((unsigned)cp&1023u); }
    else *u=(unsigned)cp;
    return 1;
}
typedef struct { const char *key; size_t len; json_t *value; } entry;
static int compare_keys(const void *a, const void *b) {
    const entry *x=a,*y=b; iterator xi={(const uint8_t *)x->key,x->len,0,0},yi={(const uint8_t *)y->key,y->len,0,0};
    unsigned xu=0,yu=0; int xn,yn;
    do { xn=next_unit(&xi,&xu); yn=next_unit(&yi,&yu); if (xn<=0 || yn<=0) return xn-yn; if (xu!=yu) return xu<yu?-1:1; } while (1);
}
static int write_string(buffer *b, const json_t *s) {
    char *encoded=json_dumps(s,JSON_ENCODE_ANY|JSON_COMPACT); int ok;
    if (!encoded) return 0;
    ebp_json_lowercase_escapes(encoded); ok=literal(b,encoded); free(encoded); return ok;
}
/* Ryu produces a shortest mantissa in scientific notation. ECMA-262 uses
 * fixed notation for exponents -6 through 20, and scientific otherwise. */
static int write_number(buffer *b, double value) {
    char raw[32],digits[24],exponent[16]; int n,nd=0,exp=0,esign=1,negative=0; size_t i=0;
    if (!isfinite(value)) return 0;
    if (value==0) return literal(b,"0");
    n=d2s_buffered_n(value,raw); if (n<=0 || (size_t)n>=sizeof(raw)) return 0; raw[n]='\0';
    if (raw[i]=='-') { negative=1; i++; }
    while (i<(size_t)n && raw[i]!='E' && raw[i]!='e') { if (raw[i]!='.') digits[nd++]=raw[i]; i++; }
    if (i==(size_t)n || !nd) return 0;
    i++; if (raw[i]=='-') { esign=-1; i++; } else if (raw[i]=='+') i++;
    while (i<(size_t)n && raw[i]>='0' && raw[i]<='9') { exp=exp*10+raw[i]-'0'; i++; }
    if (i!=(size_t)n) return 0;
    exp*=esign;
    if (negative && !literal(b,"-")) return 0;
    if (exp>=-6 && exp<21) {
        int point=exp+1;
        if (point<=0) {
            if (!literal(b,"0.")) return 0;
            for (int j=0; j< -point; j++) if (!literal(b,"0")) return 0;
            return append(b,digits,(size_t)nd);
        }
        if (point>=nd) {
            if (!append(b,digits,(size_t)nd)) return 0;
            for (int j=nd; j<point; j++) if (!literal(b,"0")) return 0;
            return 1;
        }
        return append(b,digits,(size_t)point) && literal(b,".") && append(b,digits+point,(size_t)(nd-point));
    }
    if (!append(b,digits,1) || (nd>1 && (!literal(b,".") || !append(b,digits+1,(size_t)(nd-1)))) || !literal(b,"e")) return 0;
    if (exp>=0 && !literal(b,"+")) return 0;
    { int en=snprintf(exponent,sizeof(exponent),"%d",exp); return en>0 && (size_t)en<sizeof(exponent) && append(b,exponent,(size_t)en); }
}
static int write_json(buffer *b, const json_t *value) {
    size_t i,n; int ok=0; entry *entries=NULL; void *it;
    if (json_is_null(value)) return literal(b,"null");
    if (json_is_true(value)) return literal(b,"true");
    if (json_is_false(value)) return literal(b,"false");
    if (json_is_string(value)) return write_string(b,value);
    if (json_is_number(value)) return write_number(b,json_is_integer(value)?(double)json_integer_value(value):json_real_value(value));
    if (json_is_array(value)) {
        if (!literal(b,"[")) return 0;
        for (i=0; i<json_array_size(value); i++) if ((i && !literal(b,",")) || !write_json(b,json_array_get(value,i))) return 0;
        return literal(b,"]");
    }
    if (!json_is_object(value)) return 0;
    n=json_object_size(value); if (n>SIZE_MAX/sizeof(*entries)) return 0;
    entries=malloc((n?n:1)*sizeof(*entries)); if (!entries) return 0;
    i=0;
    for (it=json_object_iter((json_t *)value); it; it=json_object_iter_next((json_t *)value,it)) {
        entries[i].key=json_object_iter_key(it); entries[i].len=json_object_iter_key_len(it); entries[i].value=json_object_iter_value(it);
        if (memchr(entries[i].key,0,entries[i].len)) goto done;
        i++;
    }
    qsort(entries,n,sizeof(*entries),compare_keys);
    if (!literal(b,"{")) goto done;
    for (i=0; i<n; i++) {
        json_t *key=json_stringn(entries[i].key,entries[i].len); int wrote;
        if (!key) goto done;
        wrote=(!i || literal(b,",")) && write_string(b,key) && literal(b,":") && write_json(b,entries[i].value);
        json_decref(key); if (!wrote) goto done;
    }
    ok=literal(b,"}");
done:
    free(entries); return ok;
}
char *ebp_jcs_dump(const json_t *value) {
    buffer b={0};
    if (!write_json(&b,value)) { free(b.data); return NULL; }
    return b.data;
}
int ebp_json_canonical(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    json_error_t error; json_t *value; char *text;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!input || !len) return 0;
    value=json_loadb((const char *)input,len,JSON_DECODE_ANY|JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL|JSON_DECODE_INT_AS_REAL,&error);
    if (!value) return 0;
    text=ebp_jcs_dump(value); json_decref(value); if (!text) return 0;
    *out=(uint8_t *)text; *out_len=strlen(text); return 1;
}
int ebp_json_state_hash(const uint8_t *input, size_t len, uint8_t out[32]) {
    uint8_t *canonical=NULL; size_t n=0; int ok;
    if (!out || !ebp_json_canonical(input,len,&canonical,&n)) return 0;
    ok=ebp_sha256(canonical,n,out); ebp_free(canonical); return ok;
}
int ebp_identity_state_from_external(const uint8_t *external, size_t external_len, const uint8_t *details, size_t details_len,
                                     uint8_t **out, size_t *out_len) {
    static const char *required[]={"fingerprint","signingKeyType","encryptionKeyType","signingKey","encryptionKey"};
    static const char *optional[]={"signingKeyDetails","encryptionKeyDetails"};
    json_error_t error; json_t *ext=NULL,*detail_obj=NULL,*state=NULL,*value; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!external || !external_len || !details || !details_len ||
        !(ext=json_loadb((const char *)external,external_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error)) ||
        !(detail_obj=json_loadb((const char *)details,details_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error)) ||
        !json_is_object(ext) || !json_is_object(detail_obj) || !(state=json_object())) goto done;
    for (size_t i=0;i<sizeof(required)/sizeof(required[0]);i++) {
        value=json_object_get(ext,required[i]);
        if (!json_is_string(value) || json_object_set(state,required[i],value)!=0) goto done;
    }
    for (size_t i=0;i<sizeof(optional)/sizeof(optional[0]);i++) {
        value=json_object_get(ext,optional[i]);
        if (!value) value=json_null();
        if (json_object_set(state,optional[i],value)!=0) goto done;
    }
    if (json_object_set(state,"details",detail_obj)!=0 || !(text=ebp_jcs_dump(state))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(ext); json_decref(detail_obj); json_decref(state); return ok;
}
