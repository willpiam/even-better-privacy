#include "ebp_core.h"
#include "json_compat.h"
#include "jcs.h"
#include <jansson.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <utf8proc.h>

static int js_space(utf8proc_int32_t cp) {
    return (cp>=9 && cp<=13) || cp==0x20 || cp==0xa0 || cp==0x1680 ||
           (cp>=0x2000 && cp<=0x200a) || cp==0x2028 || cp==0x2029 || cp==0x202f || cp==0x205f || cp==0x3000 || cp==0xfeff;
}
static json_t *js_trimmed(const json_t *value) {
    const uint8_t *text; size_t len,pos=0,start=0,end=0; int found=0;
    if (!json_is_string(value)) return NULL;
    text=(const uint8_t *)json_string_value(value); len=json_string_length(value);
    if (len>PTRDIFF_MAX) return NULL;
    while (pos<len) {
        utf8proc_int32_t cp; size_t before=pos;
        utf8proc_ssize_t n=utf8proc_iterate(text+pos,(utf8proc_ssize_t)(len-pos),&cp);
        if (n<=0) return NULL;
        pos+=(size_t)n;
        if (!js_space(cp)) { if (!found) start=before; end=pos; found=1; }
    }
    return json_stringn((const char *)text+(found?start:0),found?end-start:0);
}
typedef struct { const uint8_t *text; size_t len,pos; unsigned pending; } utf16_iter;
static int next_unit(utf16_iter *it, unsigned *out) {
    utf8proc_int32_t cp; utf8proc_ssize_t n;
    if (it->pending) { *out=it->pending; it->pending=0; return 1; }
    if (it->pos==it->len) return 0;
    n=utf8proc_iterate(it->text+it->pos,(utf8proc_ssize_t)(it->len-it->pos),&cp);
    if (n<=0) return -1;
    it->pos+=(size_t)n;
    if (cp>0xffff) { cp-=0x10000; *out=0xd800u+((unsigned)cp>>10); it->pending=0xdc00u+((unsigned)cp&1023u); }
    else *out=(unsigned)cp;
    return 1;
}
static int compare_utf16(const json_t *a, const json_t *b) {
    utf16_iter ai={(const uint8_t *)json_string_value(a),json_string_length(a),0,0};
    utf16_iter bi={(const uint8_t *)json_string_value(b),json_string_length(b),0,0};
    unsigned av=0,bv=0; int an,bn;
    do {
        an=next_unit(&ai,&av); bn=next_unit(&bi,&bv);
        if (an<=0 || bn<=0) return an-bn;
        if (av!=bv) return av<bv?-1:1;
    } while (1);
}
static int compare_manifest(const json_t *a, const json_t *b) {
    json_t *ak=json_object_get(a,"attachmentId"), *bk=json_object_get(b,"attachmentId");
    int result=compare_utf16(ak,bk);
    return result?result:compare_utf16(json_object_get(a,"ciphertextSha256"),json_object_get(b,"ciphertextSha256"));
}
static json_t *stable_sort(json_t *array, int manifest) {
    json_t **items=NULL,**tmp=NULL,**swap,*sorted=NULL; size_t n=json_array_size(array),width;
    if (n>SIZE_MAX/sizeof(*items)) return NULL;
    sorted=json_array(); if (!sorted) return NULL;
    if (!n) return sorted;
    items=malloc(n*sizeof(*items)); tmp=malloc(n*sizeof(*tmp));
    if (!items || !tmp) goto fail;
    for (size_t i=0; i<n; i++) items[i]=json_array_get(array,i);
    for (width=1; width<n;) {
        for (size_t start=0; start<n;) {
            size_t mid=start+(n-start<width?n-start:width),end=mid+(n-mid<width?n-mid:width);
            size_t i=start,j=mid,k=start;
            while (i<mid && j<end) {
                int c=manifest?compare_manifest(items[i],items[j]):compare_utf16(items[i],items[j]);
                tmp[k++]=c<=0?items[i++]:items[j++];
            }
            while (i<mid) tmp[k++]=items[i++];
            while (j<end) tmp[k++]=items[j++];
            start=end;
        }
        swap=items; items=tmp; tmp=swap;
        if (width>n/2) break;
        width*=2;
    }
    for (size_t i=0; i<n; i++) if (json_array_append(sorted,items[i])!=0) goto fail;
    free(items); free(tmp); return sorted;
fail:
    free(items); free(tmp); json_decref(sorted); return NULL;
}
static int normalize_arrays(const uint8_t *recipients_json, size_t recipients_len,
                            const uint8_t *manifest_json, size_t manifest_len,
                            json_t **out_recipients, json_t **out_manifest) {
    json_error_t error; json_t *recipients=NULL,*manifest=NULL,*trimmed=NULL,*entries=NULL,*sorted_r=NULL,*sorted_m=NULL;
    int ok=0;
    if (!recipients_json || !manifest_json || !out_recipients || !out_manifest) return 0;
    *out_recipients=NULL; *out_manifest=NULL;
    recipients=json_loadb((const char *)recipients_json,recipients_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    manifest=json_loadb((const char *)manifest_json,manifest_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_array(recipients) || !json_is_array(manifest)) goto done;
    trimmed=json_array(); entries=json_array();
    if (!trimmed || !entries) goto done;
    for (size_t i=0; i<json_array_size(recipients); i++) {
        json_t *value=js_trimmed(json_array_get(recipients,i));
        if (!value) goto done;
        if (json_string_length(value)==0) json_decref(value);
        else if (json_array_append_new(trimmed,value)!=0) goto done;
    }
    for (size_t i=0; i<json_array_size(manifest); i++) {
        json_t *item=json_array_get(manifest,i),*id=json_is_object(item)?json_object_get(item,"attachmentId"):NULL;
        json_t *hash=json_is_object(item)?json_object_get(item,"ciphertextSha256"):NULL,*copy;
        if (!json_is_string(id) || !json_is_string(hash)) goto done;
        copy=json_object(); if (!copy) goto done;
        if (json_object_set(copy,"attachmentId",id)!=0 || json_object_set(copy,"ciphertextSha256",hash)!=0) { json_decref(copy); goto done; }
        if (json_array_append_new(entries,copy)!=0) goto done;
    }
    sorted_r=stable_sort(trimmed,0); sorted_m=stable_sort(entries,1);
    if (!sorted_r || !sorted_m) goto done;
    *out_recipients=sorted_r; sorted_r=NULL; *out_manifest=sorted_m; sorted_m=NULL; ok=1;
done:
    json_decref(sorted_r); json_decref(sorted_m); json_decref(entries); json_decref(trimmed);
    json_decref(manifest); json_decref(recipients); return ok;
}
int ebp_multi_normalize(const uint8_t *recipients_json, size_t recipients_len,
                        const uint8_t *manifest_json, size_t manifest_len,
                        uint8_t **out, size_t *out_len) {
    json_t *recipients=NULL,*manifest=NULL,*obj=NULL; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!normalize_arrays(recipients_json,recipients_len,manifest_json,manifest_len,&recipients,&manifest)) return 0;
    obj=json_object();
    if (!obj || json_object_set(obj,"recipientFingerprints",recipients)!=0 ||
        json_object_set(obj,"attachmentManifest",manifest)!=0 || !(text=json_dumps(obj,JSON_COMPACT))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(obj); json_decref(recipients); json_decref(manifest); return ok;
}
int ebp_multi_envelope(const uint8_t *message, size_t message_len,
                       const uint8_t *recipients_json, size_t recipients_len,
                       const uint8_t *manifest_json, size_t manifest_len,
                       const uint8_t *salt, size_t salt_len,
                       uint8_t **out, size_t *out_len) {
    static const char prefix[]="ebp::messagehash::v4::", hex[]="0123456789abcdef";
    json_t *sorted_r=NULL,*sorted_m=NULL,*obj=NULL; char *canonical=NULL; uint8_t digest[32],*result=NULL;
    size_t n,total; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!message && message_len) || (!salt && salt_len) || salt_len>SIZE_MAX-(sizeof(prefix)-1)-66 ||
        !normalize_arrays(recipients_json,recipients_len,manifest_json,manifest_len,&sorted_r,&sorted_m)) return 0;
    obj=json_object();
    if (!obj || json_object_set_new(obj,"tag",json_string("EBP-MULTIRECIPIENT-V4"))!=0 ||
        json_object_set_new(obj,"message",json_stringn((const char *)(message?message:(const uint8_t *)""),message_len))!=0 ||
        json_object_set(obj,"recipientFingerprints",sorted_r)!=0 || json_object_set(obj,"attachmentManifest",sorted_m)!=0 ||
        !(canonical=ebp_jcs_dump(obj))) goto done;
    if (!ebp_sha256((const uint8_t *)canonical,strlen(canonical),digest)) goto done;
    total=sizeof(prefix)-1+64+2+salt_len; result=malloc(total); if (!result) goto done;
    n=sizeof(prefix)-1; memcpy(result,prefix,n);
    for (size_t i=0; i<sizeof(digest); i++) { result[n++]=hex[digest[i]>>4]; result[n++]=hex[digest[i]&15]; }
    result[n++]=':'; result[n++]=':'; if (salt_len) memcpy(result+n,salt,salt_len);
    *out=result; *out_len=total; result=NULL; ok=1;
done:
    free(result); if (canonical) ebp_secure_free(canonical,strlen(canonical));
    json_decref(obj); json_decref(sorted_r); json_decref(sorted_m); return ok;
}
