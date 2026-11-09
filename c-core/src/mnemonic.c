#include "ebp_core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <utf8proc.h>

static const char *const words[2048] = {
#include "bip39_words.inc"
};
#define CANON_MAX 216
#define ENTROPY_MAX 32

static int valid_entropy_len(size_t len) {
    return len >= 16 && len <= 32 && len % 4 == 0;
}
static int is_js_space(utf8proc_int32_t c) {
    return (c >= 9 && c <= 13) || c == 0x20 || c == 0xa0 || c == 0x1680 ||
           (c >= 0x2000 && c <= 0x200a) || c == 0x2028 || c == 0x2029 ||
           c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff;
}
static int word_index(const char *word) {
    int lo = 0, hi = 2047;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2, c = strcmp(word, words[mid]);
        if (!c) return mid;
        if (c < 0) hi = mid - 1; else lo = mid + 1;
    }
    return -1;
}
static int nfkd(const uint8_t *input, size_t len, uint8_t **out, size_t *out_len) {
    utf8proc_ssize_t n;
    if ((!input && len) || len > PTRDIFF_MAX) return 0;
    n = utf8proc_map(input ? input : (const uint8_t *)"", (utf8proc_ssize_t)len, out,
                     UTF8PROC_STABLE | UTF8PROC_COMPAT | UTF8PROC_DECOMPOSE);
    if (n < 0) return 0;
    *out_len = (size_t)n; return 1;
}
/* Normalize and validate, returning canonical ASCII words and entropy. */
static int parse_mnemonic(const uint8_t *phrase, size_t len, char canonical[CANON_MAX],
                          size_t *canonical_len, uint8_t entropy[ENTROPY_MAX], size_t *entropy_len) {
    uint8_t *normalized = NULL, bits[33] = {0}, digest[32];
    size_t normalized_len = 0, pos = 0, count = 0, out_pos = 0, token_len = 0;
    char token[9]; int indices[24], ok = 0;
    if (!nfkd(phrase, len, &normalized, &normalized_len)) goto done;
    while (pos < normalized_len) {
        utf8proc_int32_t cp; utf8proc_ssize_t n = utf8proc_iterate(normalized + pos, (utf8proc_ssize_t)(normalized_len - pos), &cp);
        if (n <= 0) goto done;
        pos += (size_t)n;
        if (is_js_space(cp)) {
            if (!token_len) continue;
        } else {
            if (cp >= 'A' && cp <= 'Z') cp += 'a' - 'A';
            if (cp < 'a' || cp > 'z' || token_len >= sizeof(token)-1) goto done;
            token[token_len++] = (char)cp;
            if (pos != normalized_len) continue;
        }
        token[token_len] = '\0';
        if (count >= 24 || (indices[count] = word_index(token)) < 0) goto done;
        if (count) canonical[out_pos++] = ' ';
        memcpy(canonical + out_pos, token, token_len); out_pos += token_len;
        count++; token_len = 0;
    }
    if (!(count == 12 || count == 15 || count == 18 || count == 21 || count == 24)) goto done;
    *entropy_len = count * 4 / 3; *canonical_len = out_pos; canonical[out_pos] = '\0';
    for (size_t i = 0; i < count * 11; i++) {
        unsigned bit = ((unsigned)indices[i / 11] >> (10 - i % 11)) & 1u;
        bits[i / 8] |= (uint8_t)(bit << (7 - i % 8));
    }
    memcpy(entropy, bits, *entropy_len);
    if (!ebp_sha256(entropy, *entropy_len, digest)) goto done;
    for (size_t i = 0; i < *entropy_len / 4; i++) {
        size_t bit_pos = *entropy_len * 8 + i;
        if (((bits[bit_pos / 8] >> (7 - bit_pos % 8)) & 1) != ((digest[0] >> (7 - i)) & 1)) goto done;
    }
    ok = 1;
done:
    ebp_secure_free(normalized, normalized_len);
    OPENSSL_cleanse(bits, sizeof(bits)); OPENSSL_cleanse(digest, sizeof(digest));
    OPENSSL_cleanse(indices, sizeof(indices)); OPENSSL_cleanse(token, sizeof(token));
    if (!ok) { OPENSSL_cleanse(canonical, CANON_MAX); OPENSSL_cleanse(entropy, ENTROPY_MAX); }
    return ok;
}
int ebp_entropy_to_mnemonic(const uint8_t *entropy, size_t entropy_len, uint8_t **phrase, size_t *phrase_len) {
    uint8_t hash[32], *out = NULL; size_t total_bits, count, used = 0; int ok = 0;
    if (!phrase || !phrase_len) return 0;
    *phrase = NULL; *phrase_len = 0;
    if (!entropy || !valid_entropy_len(entropy_len) || !ebp_sha256(entropy, entropy_len, hash)) return 0;
    total_bits = entropy_len * 8 + entropy_len / 4; count = total_bits / 11;
    out = malloc(CANON_MAX);
    if (!out) goto done;
    for (size_t i = 0; i < count; i++) {
        unsigned index = 0;
        for (size_t j = 0; j < 11; j++) {
            size_t bit = i * 11 + j;
            unsigned value = bit < entropy_len * 8 ? (entropy[bit/8] >> (7-bit%8)) & 1u : (hash[0] >> (7-(bit-entropy_len*8))) & 1u;
            index = (index << 1) | value;
        }
        size_t word_len = strlen(words[index]);
        if (i) out[used++] = ' ';
        memcpy(out+used, words[index], word_len); used += word_len;
    }
    *phrase = out; *phrase_len = used; out = NULL; ok = 1;
done:
    ebp_secure_free(out, CANON_MAX); OPENSSL_cleanse(hash, sizeof(hash)); return ok;
}
int ebp_mnemonic_to_entropy(const uint8_t *phrase, size_t len, uint8_t **entropy, size_t *entropy_len) {
    char canonical[CANON_MAX]; uint8_t bytes[ENTROPY_MAX], *out = NULL;
    size_t canonical_len = 0, n = 0; int ok = 0;
    if (!entropy || !entropy_len) return 0;
    *entropy = NULL; *entropy_len = 0;
    if (!parse_mnemonic(phrase, len, canonical, &canonical_len, bytes, &n)) goto done;
    out = malloc(n); if (!out) goto done;
    memcpy(out, bytes, n); *entropy = out; *entropy_len = n; out = NULL; ok = 1;
done:
    ebp_secure_free(out, n); OPENSSL_cleanse(canonical, sizeof(canonical)); OPENSSL_cleanse(bytes, sizeof(bytes)); return ok;
}
int ebp_mnemonic_to_seed(const uint8_t *phrase, size_t len, const uint8_t *passphrase, size_t passphrase_len, uint8_t out[64]) {
    static const char prefix[] = "ebp-mnemonic-v2:";
    char canonical[CANON_MAX]; uint8_t entropy[ENTROPY_MAX], *normalized = NULL, *salt = NULL;
    size_t canonical_len = 0, entropy_len = 0, norm_len = 0, salt_len = 0; int ok = 0;
    if (!out || (!passphrase && passphrase_len)) return 0;
    OPENSSL_cleanse(out, 64);
    if (!parse_mnemonic(phrase, len, canonical, &canonical_len, entropy, &entropy_len) ||
        !nfkd(passphrase, passphrase_len, &normalized, &norm_len) || norm_len > INT_MAX - (sizeof(prefix)-1)) goto done;
    salt_len = sizeof(prefix)-1 + norm_len; salt = malloc(salt_len);
    if (!salt) goto done;
    memcpy(salt, prefix, sizeof(prefix)-1); memcpy(salt + sizeof(prefix)-1, normalized, norm_len);
    if (PKCS5_PBKDF2_HMAC(canonical, (int)canonical_len, salt, (int)salt_len, 2048, EVP_sha512(), 64, out) != 1) goto done;
    ok = 1;
done:
    if (!ok) OPENSSL_cleanse(out, 64);
    ebp_secure_free(normalized, norm_len); ebp_secure_free(salt, salt_len);
    OPENSSL_cleanse(canonical, sizeof(canonical)); OPENSSL_cleanse(entropy, sizeof(entropy)); return ok;
}
