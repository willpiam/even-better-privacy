#include "ebp_core.h"
#include <jansson.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/evp.h>
#include <utf8proc.h>

static int copy_string(const json_t *value, uint8_t **out, size_t *out_len) {
    size_t len; const char *text; uint8_t *copy;
    if (!json_is_string(value) || !(text=json_string_value(value)) || !(len=json_string_length(value))) return 0;
    copy=malloc(len); if (!copy) return 0;
    memcpy(copy,text,len); *out=copy; *out_len=len; return 1;
}
/* WHATWG atob accepts omitted padding and ASCII whitespace. */
static int decode_b64(const char *text, size_t text_len, uint8_t **out, size_t *out_len) {
    uint8_t *clean=NULL,*data=NULL; size_t n=0,pad=0,alloc_len; int decoded,ok=0;
    if (!text || !text_len || text_len>(size_t)INT_MAX-4) return 0;
    clean=malloc(text_len+4); if (!clean) return 0;
    for (size_t i=0; i<text_len; i++) {
        unsigned char c=(unsigned char)text[i];
        if (c==9 || c==10 || c==12 || c==13 || c==32) continue;
        if (!((c>='A' && c<='Z') || (c>='a' && c<='z') || (c>='0' && c<='9') || c=='+' || c=='/' || c=='=')) goto done;
        clean[n++]=c;
    }
    if (n==0) { data=malloc(1); if (!data) goto done; *out=data; *out_len=0; data=NULL; ok=1; goto done; }
    if (n%4==1) goto done;
    for (size_t i=0; i<n; i++) if (clean[i]=='=' && (i<n-2 || n%4!=0)) goto done;
    if (clean[n-1]=='=') pad++;
    if (n>1 && clean[n-2]=='=') pad++;
    if (pad && n%4!=0) goto done;
    while (n%4) { clean[n++]='='; pad++; }
    alloc_len=n/4*3; data=malloc(alloc_len?alloc_len:1); if (!data) goto done;
    decoded=EVP_DecodeBlock(data,clean,(int)n);
    if (decoded<0 || (size_t)decoded<pad) goto done;
    *out=data; *out_len=(size_t)decoded-pad; data=NULL; ok=1;
done:
    free(clean); if (data) ebp_secure_free(data,n/4*3); return ok;
}
int ebp_base64_decode(const uint8_t *text, size_t len, uint8_t **out, size_t *out_len) {
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!text && len) return 0;
    if (!len) { *out=malloc(1); return *out!=NULL; }
    return decode_b64((const char *)text,len,out,out_len);
}
int ebp_base64_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    uint8_t *result; size_t n;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!data && len) || len>(size_t)(INT_MAX/4)*3) return 0;
    n=4*((len+2)/3); result=malloc(n+1); if (!result) return 0;
    if (EVP_EncodeBlock(result,data?data:(const uint8_t *)"",(int)len)!=(int)n) { free(result); return 0; }
    *out=result; *out_len=n; return 1;
}
int ebp_hex_encode(const uint8_t *data, size_t len, uint8_t **out, size_t *out_len) {
    static const char alphabet[]="0123456789abcdef"; uint8_t *result;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!data && len) || len>SIZE_MAX/2 || !(result=malloc(len?len*2:1))) return 0;
    for (size_t i=0;i<len;i++) { result[i*2]=(uint8_t)alphabet[data[i]>>4]; result[i*2+1]=(uint8_t)alphabet[data[i]&15]; }
    *out=result; *out_len=len*2; return 1;
}
static int hex_digit(uint8_t c) {
    if (c>='0' && c<='9') return c-'0';
    if (c>='a' && c<='f') return c-'a'+10;
    if (c>='A' && c<='F') return c-'A'+10;
    return -1;
}
int ebp_hex_decode(const uint8_t *text, size_t len, uint8_t **out, size_t *out_len) {
    uint8_t *result;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!text && len) || len%2 || !(result=malloc(len?len/2:1))) return 0;
    for (size_t i=0;i<len/2;i++) {
        int a=hex_digit(text[i*2]),b=hex_digit(text[i*2+1]);
        if (a<0 || b<0) { free(result); return 0; }
        result[i]=(uint8_t)((a<<4)|b);
    }
    *out=result; *out_len=len/2; return 1;
}
int ebp_file_envelope_create(const uint8_t *file, size_t file_len, const uint8_t *name, size_t name_len,
                             const uint8_t *mime, size_t mime_len, uint8_t **out, size_t *out_len) {
    static const char default_name[]="encrypted.bin", default_mime[]="application/octet-stream";
    json_t *obj=NULL; char *encoded=NULL,*text=NULL; size_t encoded_len; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!file && file_len) || (!name && name_len) || (!mime && mime_len) || file_len>(size_t)(INT_MAX/4)*3) return 0;
    if (!name_len) { name=(const uint8_t *)default_name; name_len=sizeof(default_name)-1; }
    if (!mime_len) { mime=(const uint8_t *)default_mime; mime_len=sizeof(default_mime)-1; }
    encoded_len=4*((file_len+2)/3); encoded=malloc(encoded_len+1); if (!encoded) return 0;
    if (EVP_EncodeBlock((uint8_t *)encoded,file?file:(const uint8_t *)"",(int)file_len)!=(int)encoded_len) goto done;
    obj=json_object();
    if (!obj || json_object_set_new(obj,"type",json_string("ebp-file-cleartext-envelope"))!=0 ||
        json_object_set_new(obj,"version",json_integer(1))!=0 ||
        json_object_set_new(obj,"fileName",json_stringn((const char *)name,name_len))!=0 ||
        json_object_set_new(obj,"mimeType",json_stringn((const char *)mime,mime_len))!=0 ||
        json_object_set_new(obj,"fileSize",json_integer((json_int_t)file_len))!=0 ||
        json_object_set_new(obj,"fileDataBase64",json_string(encoded))!=0 ||
        !(text=json_dumps(obj,JSON_COMPACT))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    if (encoded) ebp_secure_free(encoded,encoded_len);
    free(text); json_decref(obj); return ok;
}
int ebp_file_envelope_parse(const uint8_t *input, size_t len, uint8_t **file, size_t *file_len,
                            uint8_t **name, size_t *name_len, uint8_t **mime, size_t *mime_len) {
    json_t *obj=NULL,*type,*version,*fname,*ftype,*fsize,*fdata; json_error_t error;
    uint8_t *data=NULL,*name_data=NULL,*mime_data=NULL; size_t data_len=0,name_n=0,mime_n=0; int ok=0;
    if (!file || !file_len || !name || !name_len || !mime || !mime_len) return 0;
    *file=NULL; *file_len=0; *name=NULL; *name_len=0; *mime=NULL; *mime_len=0;
    if (!input || !len) return 0;
    obj=json_loadb((const char *)input,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!json_is_object(obj)) goto done;
    type=json_object_get(obj,"type"); version=json_object_get(obj,"version");
    fname=json_object_get(obj,"fileName"); ftype=json_object_get(obj,"mimeType");
    fsize=json_object_get(obj,"fileSize"); fdata=json_object_get(obj,"fileDataBase64");
    if (!json_is_string(type) || json_string_length(type)!=strlen("ebp-file-cleartext-envelope") ||
        memcmp(json_string_value(type),"ebp-file-cleartext-envelope",strlen("ebp-file-cleartext-envelope"))!=0 ||
        !json_is_number(version) || json_number_value(version)!=1 || !json_is_number(fsize) ||
        !isfinite(json_number_value(fsize)) || json_number_value(fsize)<0 || floor(json_number_value(fsize))!=json_number_value(fsize) ||
        !json_is_string(fdata) ||
        !ebp_base64_decode((const uint8_t *)json_string_value(fdata),json_string_length(fdata),&data,&data_len) ||
        (double)data_len!=json_number_value(fsize) || !copy_string(fname,&name_data,&name_n) || !copy_string(ftype,&mime_data,&mime_n)) goto done;
    *file=data; *file_len=data_len; data=NULL; *name=name_data; *name_len=name_n; name_data=NULL;
    *mime=mime_data; *mime_len=mime_n; mime_data=NULL; ok=1;
done:
    ebp_secure_free(data,data_len); free(name_data); free(mime_data); json_decref(obj); return ok;
}

/* TypeScript String.trim whitespace, shared with attachment validation. */
static int attachment_nonblank(const json_t *value) {
    const uint8_t *text; size_t len,pos=0;
    if (!json_is_string(value)) return 0;
    text=(const uint8_t *)json_string_value(value); len=json_string_length(value);
    if (len>PTRDIFF_MAX) return 0;
    while (pos<len) {
        utf8proc_int32_t cp; utf8proc_ssize_t n=utf8proc_iterate(text+pos,(utf8proc_ssize_t)(len-pos),&cp);
        if (n<=0) return 0;
        pos+=(size_t)n;
        if (!((cp>=9 && cp<=13) || cp==0x20 || cp==0xa0 || cp==0x1680 ||
              (cp>=0x2000 && cp<=0x200a) || cp==0x2028 || cp==0x2029 || cp==0x202f || cp==0x205f || cp==0x3000 || cp==0xfeff)) return 1;
    }
    return 0;
}
int ebp_email_attachment_create(const uint8_t *file, size_t file_len, const uint8_t *name, size_t name_len,
                                const uint8_t *mime, size_t mime_len, const uint8_t *id, size_t id_len,
                                const uint8_t *body_hash, size_t body_hash_len, uint8_t **out, size_t *out_len) {
    uint8_t *file_json=NULL; size_t file_json_len=0; json_t *obj=NULL; json_error_t error; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!id && id_len) || (!body_hash && body_hash_len) ||
        !ebp_file_envelope_create(file,file_len,name,name_len,mime,mime_len,&file_json,&file_json_len)) return 0;
    obj=json_loadb((const char *)file_json,file_json_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!obj || json_object_set_new(obj,"type",json_string("ebp-email-attachment-cleartext-envelope"))!=0 ||
        json_object_set_new(obj,"attachmentId",json_stringn((const char *)(id?id:(const uint8_t *)""),id_len))!=0 ||
        (body_hash && json_object_set_new(obj,"bodyPayloadHash",json_stringn((const char *)body_hash,body_hash_len))!=0) ||
        !(text=json_dumps(obj,JSON_COMPACT))) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); free(file_json); json_decref(obj); return ok;
}
int ebp_email_attachment_parse(const uint8_t *input, size_t len, uint8_t **file, size_t *file_len,
                               uint8_t **metadata, size_t *metadata_len) {
    json_t *obj=NULL,*type,*version,*body,*meta=NULL; json_error_t error; char *file_json=NULL,*meta_json=NULL;
    uint8_t *data=NULL,*name=NULL,*mime=NULL; size_t data_len=0,name_len=0,mime_len=0; int ok=0;
    if (!file || !file_len || !metadata || !metadata_len) return 0;
    *file=NULL; *file_len=0; *metadata=NULL; *metadata_len=0;
    if (!input || !len || !(obj=json_loadb((const char *)input,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error)) || !json_is_object(obj)) goto done;
    type=json_object_get(obj,"type"); version=json_object_get(obj,"version"); body=json_object_get(obj,"bodyPayloadHash");
    if (!json_is_string(type) || json_string_length(type)!=strlen("ebp-email-attachment-cleartext-envelope") ||
        memcmp(json_string_value(type),"ebp-email-attachment-cleartext-envelope",json_string_length(type))!=0 ||
        !json_is_number(version) || json_number_value(version)!=1 ||
        !attachment_nonblank(json_object_get(obj,"attachmentId")) || !attachment_nonblank(json_object_get(obj,"fileName")) ||
        !attachment_nonblank(json_object_get(obj,"mimeType")) || !attachment_nonblank(json_object_get(obj,"fileDataBase64")) ||
        (body && !attachment_nonblank(body))) goto done;
    meta=json_object();
    if (!meta || json_object_set(meta,"attachmentId",json_object_get(obj,"attachmentId"))!=0 ||
        json_object_set(meta,"fileName",json_object_get(obj,"fileName"))!=0 || json_object_set(meta,"mimeType",json_object_get(obj,"mimeType"))!=0 ||
        json_object_set(meta,"fileSize",json_object_get(obj,"fileSize"))!=0 || (body && json_object_set(meta,"bodyPayloadHash",body)!=0) ||
        json_object_set_new(obj,"type",json_string("ebp-file-cleartext-envelope"))!=0 || !(file_json=json_dumps(obj,JSON_COMPACT)) ||
        !ebp_file_envelope_parse((const uint8_t *)file_json,strlen(file_json),&data,&data_len,&name,&name_len,&mime,&mime_len) ||
        !(meta_json=json_dumps(meta,JSON_COMPACT))) goto done;
    *file=data; *file_len=data_len; data=NULL; *metadata=(uint8_t *)meta_json; *metadata_len=strlen(meta_json); meta_json=NULL; ok=1;
done:
    ebp_secure_free(data,data_len); free(name); free(mime); free(file_json); free(meta_json); json_decref(meta); json_decref(obj); return ok;
}
int ebp_encrypted_email_attachment_parse(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    json_t *obj=NULL,*type,*version,*result=NULL; json_error_t error; const char *name; char *text=NULL;
    const char *fields[7]={"type","version","attachmentId","ciphertext",NULL,NULL,NULL}; int kind=0,ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!input || !len || !(obj=json_loadb((const char *)input,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error)) || !json_is_object(obj)) goto done;
    type=json_object_get(obj,"type"); version=json_object_get(obj,"version"); name=json_string_value(type);
    if (!name || strlen(name)!=json_string_length(type) || !json_is_integer(version) || json_integer_value(version)!=1 ||
        !attachment_nonblank(json_object_get(obj,"attachmentId")) || !attachment_nonblank(json_object_get(obj,"ciphertext"))) goto done;
    if (!strcmp(name,"ebp-encrypted-email-attachment")) { kind=1; fields[4]="recipientFingerprint"; }
    else if (!strcmp(name,"ebp-encrypted-signed-email-attachment")) { kind=2; fields[4]="recipientFingerprint"; fields[5]="senderFingerprint"; }
    else if (!strcmp(name,"ebp-encrypted-signed-email-attachment-multi")) { kind=3; fields[4]="senderFingerprint"; fields[5]="contentNonce"; }
    if (!kind || !attachment_nonblank(json_object_get(obj,fields[4])) || (fields[5] && !attachment_nonblank(json_object_get(obj,fields[5])))) goto done;
    result=json_object(); if (!result) goto done;
    for (size_t i=0; fields[i]; i++) if (json_object_set(result,fields[i],json_object_get(obj,fields[i]))!=0) goto done;
    text=json_dumps(result,JSON_COMPACT); if (!text) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(result); json_decref(obj); return ok;
}
