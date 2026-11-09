#include "ebp_core.h"
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
        {"ebp-encrypted-signed-message",1}, {"ebp-encrypted-signed-message-multi",1},
        {"ebp-file-cleartext-envelope",1}, {"ebp-encrypted-file",1}, {"ebp-encrypted-signed-file",1},
        {"ebp-email-attachment-cleartext-envelope",1}, {"ebp-encrypted-email-attachment",1},
        {"ebp-encrypted-signed-email-attachment",1}, {"ebp-encrypted-signed-email-attachment-multi",1}
    };
    json_t *type, *version; const char *name;
    if (!json_is_object(obj)) return 0;
    type=json_object_get(obj,"type"); version=json_object_get(obj,"version");
    if (!json_is_string(type) || !json_is_integer(version)) return 0;
    name=json_string_value(type);
    if (strlen(name) != json_string_length(type)) return 0;
    for (size_t i=0; i<sizeof(formats)/sizeof(formats[0]); i++) {
        if (strcmp(name,formats[i].name)==0) return json_integer_value(version)==formats[i].version;
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
