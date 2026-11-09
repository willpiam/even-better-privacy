#include "ebp_core.h"
#include <jansson.h>
#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/evp.h>

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
        !json_is_string(fdata) || !json_string_length(fdata) ||
        !decode_b64(json_string_value(fdata),json_string_length(fdata),&data,&data_len) ||
        (double)data_len!=json_number_value(fsize) || !copy_string(fname,&name_data,&name_n) || !copy_string(ftype,&mime_data,&mime_n)) goto done;
    *file=data; *file_len=data_len; data=NULL; *name=name_data; *name_len=name_n; name_data=NULL;
    *mime=mime_data; *mime_len=mime_n; mime_data=NULL; ok=1;
done:
    ebp_secure_free(data,data_len); free(name_data); free(mime_data); json_decref(obj); return ok;
}
