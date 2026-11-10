#include "ebp_core.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

int ebp_message_envelope(int purpose, const uint8_t *message, size_t len, const uint8_t *salt, size_t salt_len,
                         uint8_t **out, size_t *out_len) {
    const char *prefix; const char *hex = "0123456789abcdef";
    uint8_t digest[32], *buf; size_t plen, total;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if ((!message && len) || (!salt && salt_len)) return 0;
    switch (purpose) {
        case EBP_MESSAGE: prefix = "ebp::message::v1::"; break;
        case EBP_DETAIL_PROOF: prefix = "ebp::detail-proof::v2::"; break;
        case EBP_REVOCATION: prefix = "ebp::revocation::v2::"; break;
        case EBP_HIERARCHY: prefix = "ebp::hierarchy::v2::"; break;
        default: return 0;
    }
    plen = strlen(prefix);
    if (salt_len > SIZE_MAX - plen - 66 || !ebp_sha256(message, len, digest)) return 0;
    total = plen + 66 + salt_len;
    buf = malloc(total);
    if (!buf) return 0;
    memcpy(buf, prefix, plen);
    for (size_t i = 0; i < sizeof(digest); i++) { buf[plen + i*2] = hex[digest[i] >> 4]; buf[plen + i*2+1] = hex[digest[i] & 15]; }
    buf[plen + 64] = ':'; buf[plen + 65] = ':';
    if (salt_len) memcpy(buf + plen + 66, salt, salt_len);
    *out = buf; *out_len = total; return 1;
}

int ebp_recipient_envelope(const uint8_t *recipient, size_t recipient_len,
                           const uint8_t *message, size_t message_len,
                           const uint8_t *salt, size_t salt_len, uint8_t **out, size_t *out_len) {
    static const char prefix[] = "ebp::messagehash::v2::";
    static const char hex[] = "0123456789abcdef";
    uint8_t digest[32], *buf; size_t pos, total;
    if (!out || !out_len) return 0;
    *out = NULL; *out_len = 0;
    if ((!recipient && recipient_len) || (!message && message_len) || (!salt && salt_len)) return 0;
    if (recipient_len > SIZE_MAX - (sizeof(prefix)-1) - 68 ||
        salt_len > SIZE_MAX - (sizeof(prefix)-1) - 68 - recipient_len ||
        !ebp_sha256(message, message_len, digest)) return 0;
    total = sizeof(prefix)-1 + recipient_len + 2 + 64 + 2 + salt_len;
    buf = malloc(total);
    if (!buf) return 0;
    pos = sizeof(prefix)-1; memcpy(buf, prefix, pos);
    if (recipient_len) memcpy(buf + pos, recipient, recipient_len);
    pos += recipient_len; buf[pos++] = ':'; buf[pos++] = ':';
    for (size_t i = 0; i < sizeof(digest); i++) { buf[pos++] = hex[digest[i] >> 4]; buf[pos++] = hex[digest[i] & 15]; }
    buf[pos++] = ':'; buf[pos++] = ':';
    if (salt_len) memcpy(buf + pos, salt, salt_len);
    *out = buf; *out_len = total; return 1;
}
int ebp_file_sign_message(const uint8_t *hash, size_t hash_len, const uint8_t *salt, size_t salt_len,
                          const uint8_t *context, size_t context_len, uint8_t **out, size_t *out_len) {
    static const char prefix[]="ebp::filehash::"; uint8_t *buf; size_t n,total;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if ((!hash && hash_len) || (!salt && salt_len) || (!context && context_len) ||
        hash_len>SIZE_MAX-(sizeof(prefix)-1)-4 || salt_len>SIZE_MAX-(sizeof(prefix)-1)-4-hash_len ||
        context_len>SIZE_MAX-(sizeof(prefix)-1)-4-hash_len-salt_len) return 0;
    total=sizeof(prefix)-1+hash_len+salt_len+context_len+4; buf=malloc(total); if (!buf) return 0;
    n=sizeof(prefix)-1; memcpy(buf,prefix,n);
    if (hash_len) memcpy(buf+n,hash,hash_len);
    n+=hash_len; memcpy(buf+n,"::",2); n+=2;
    if (salt_len) memcpy(buf+n,salt,salt_len);
    n+=salt_len; memcpy(buf+n,"::",2); n+=2;
    if (context_len) memcpy(buf+n,context,context_len);
    *out=buf; *out_len=total; return 1;
}
