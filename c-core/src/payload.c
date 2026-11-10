#include "ebp_core.h"
#include "json_compat.h"
#include <jansson.h>
#include <stdlib.h>
#include <string.h>

static const char begin[] = "-----BEGIN EBP MESSAGE-----";
static const char end[] = "-----END EBP MESSAGE-----";
static const uint8_t *find_bytes(const uint8_t *input, size_t len, const char *needle, size_t nlen) {
    if (nlen > len) return NULL;
    for (size_t i=0; i<=len-nlen; i++) if (memcmp(input+i,needle,nlen)==0) return input+i;
    return NULL;
}
static int supported_payload(const json_t *obj) {
    static const struct { const char *name; int version; } formats[] = {
        {"ebp-signature",2}, {"ebp-signed-message",2}, {"ebp-encrypted-message",1},
        {"ebp-encrypted-signed-message",1}, {"ebp-encrypted-signed-message-multi",2},
        {"ebp-file-cleartext-envelope",1}, {"ebp-encrypted-file",1}, {"ebp-encrypted-signed-file",1},
        {"ebp-email-attachment-cleartext-envelope",1}, {"ebp-encrypted-email-attachment",1},
        {"ebp-encrypted-signed-email-attachment",1}, {"ebp-encrypted-signed-email-attachment-multi",1},
        {"ebp-emergency-revocation-certificate",2}
    };
    json_t *type, *version; const char *name;
    if (!json_is_object(obj)) return 0;
    type=json_object_get(obj,"type"); version=json_object_get(obj,"version");
    if (!json_is_string(type)) return 0;
    name=json_string_value(type);
    if (strlen(name) != json_string_length(type)) return 0;
    if (!strcmp(name,"ebp-signed-file") && !version) return 1;
    if (!ebp_json_is_safe_integer(version)) return 0;
    for (size_t i=0; i<sizeof(formats)/sizeof(formats[0]); i++) {
        if (strcmp(name,formats[i].name)==0) return ebp_json_safe_integer(version)==formats[i].version;
    }
    return 0;
}
static json_t *parse(const uint8_t *input, size_t len) {
    const uint8_t *start, *finish; json_error_t error; json_t *obj;
    if (!input || !len) return NULL;
    start=find_bytes(input,len,begin,sizeof(begin)-1);
    finish=find_bytes(input,len,end,sizeof(end)-1);
    if (start && finish && finish>start) {
        start+=sizeof(begin)-1;
        if (finish<start) return NULL;
        len=(size_t)(finish-start); input=start;
    }
    obj=json_loadb((const char *)input,len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    if (!supported_payload(obj)) { json_decref(obj); return NULL; }
    return obj;
}
int ebp_payload_parse(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    json_t *obj; char *text;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    obj=parse(input,len); if (!obj) return 0;
    text=json_dumps(obj,JSON_COMPACT | JSON_ENSURE_ASCII); json_decref(obj);
    if (!text) return 0;
    *out=(uint8_t *)text; *out_len=strlen(text); return 1;
}
int ebp_payload_armor(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    json_t *obj; char *text; uint8_t *result; size_t text_len, total;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    obj=parse(input,len); if (!obj) return 0;
    text=json_dumps(obj,JSON_INDENT(2) | JSON_ENSURE_ASCII); json_decref(obj);
    if (!text) return 0;
    text_len=strlen(text);
    if (text_len>SIZE_MAX - sizeof(begin) - sizeof(end)) { free(text); return 0; }
    total=sizeof(begin)-1 + 1 + text_len + 1 + sizeof(end)-1;
    result=malloc(total); if (!result) { free(text); return 0; }
    memcpy(result,begin,sizeof(begin)-1); result[sizeof(begin)-1]='\n';
    memcpy(result+sizeof(begin),text,text_len); result[sizeof(begin)+text_len]='\n';
    memcpy(result+sizeof(begin)+text_len+1,end,sizeof(end)-1);
    free(text); *out=result; *out_len=total; return 1;
}
int ebp_payload_build(const char *type, const uint8_t *fields, size_t fields_len, uint8_t **out, size_t *out_len) {
    static const struct { const char *type; int version; const char *required[8]; const char *optional; } specs[] = {
        {"ebp-signature",2,{"fingerprint","messageHash","salt","signature",NULL},"identity"},
        {"ebp-signed-message",2,{"fingerprint","message","messageHash","salt","signature",NULL},"identity"},
        {"ebp-encrypted-message",1,{"recipientFingerprint","ciphertext",NULL},NULL},
        {"ebp-encrypted-signed-message",1,{"recipientFingerprint","senderFingerprint","ciphertext",NULL},"senderIdentity"},
        {"ebp-encrypted-signed-message-multi",2,{"senderFingerprint","recipients","contentNonce","ciphertext",NULL},"senderIdentity"},
        {"ebp-encrypted-file",1,{"recipientFingerprint","fileName","mimeType","fileSize","ciphertext",NULL},NULL},
        {"ebp-encrypted-signed-file",1,{"recipientFingerprint","senderFingerprint","fileName","mimeType","fileSize","ciphertext",NULL},NULL}
    };
    json_error_t error; json_t *input=NULL,*result=NULL,*value; char *text=NULL; int ok=0; size_t spec;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!type || !fields || !fields_len) return 0;
    for (spec=0; spec<sizeof(specs)/sizeof(specs[0]); spec++) if (strcmp(type,specs[spec].type)==0) break;
    if (spec==sizeof(specs)/sizeof(specs[0])) return 0;
    input=json_loadb((const char *)fields,fields_len,JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error);
    result=json_object();
    if (!json_is_object(input) || !result || json_object_set_new(result,"type",json_string(type))!=0 ||
        json_object_set_new(result,"version",json_integer(specs[spec].version))!=0) goto done;
    for (size_t i=0; specs[spec].required[i]; i++) {
        const char *name=specs[spec].required[i]; value=json_object_get(input,name);
        if (!value || (strcmp(name,"fileSize")==0 ? !ebp_json_is_safe_integer(value) || ebp_json_safe_integer(value)<0 || ebp_json_safe_integer(value)>INT64_C(9007199254740991)
                      : strcmp(name,"recipients")==0 ? !json_is_array(value) : !json_is_string(value)) || json_object_set(result,name,value)!=0) goto done;
    }
    if (specs[spec].optional && (value=json_object_get(input,specs[spec].optional)) && json_object_set(result,specs[spec].optional,value)!=0) goto done;
    text=json_dumps(result,JSON_COMPACT|JSON_ENSURE_ASCII); if (!text) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(input); json_decref(result); return ok;
}
int ebp_multi_recipient_entries_parse(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    static const char *names[]={"fingerprint","kemCiphertext","keyWrapNonce","wrappedContentKey"};
    json_error_t error; json_t *value=NULL,*result=NULL,*entry,*copy; char *text=NULL; int ok=0;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!input || !len || !(value=json_loadb((const char *)input,len,JSON_DECODE_ANY|JSON_REJECT_DUPLICATES|JSON_ALLOW_NUL,&error)) || !(result=json_array())) goto done;
    if (json_is_array(value)) for (size_t i=0; i<json_array_size(value); i++) {
        int valid=1; entry=json_array_get(value,i);
        if (!json_is_object(entry)) continue;
        for (size_t j=0;j<4;j++) {
            json_t *field=json_object_get(entry,names[j]);
            if (!json_is_string(field) || !json_string_length(field)) { valid=0; break; }
        }
        if (!valid) continue;
        copy=json_object(); if (!copy) goto done;
        for (size_t j=0;j<4;j++) if (json_object_set(copy,names[j],json_object_get(entry,names[j]))!=0) { json_decref(copy); goto done; }
        if (json_array_append_new(result,copy)!=0) goto done;
    }
    text=json_dumps(result,JSON_COMPACT|JSON_ENCODE_ANY); if (!text) goto done;
    *out=(uint8_t *)text; *out_len=strlen(text); text=NULL; ok=1;
done:
    free(text); json_decref(result); json_decref(value); return ok;
}
