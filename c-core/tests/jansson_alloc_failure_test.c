/* Exercise the bundled parser's allocation failures with the parser itself
 * instrumented by AddressSanitizer. This runs in a single-threaded process
 * because Jansson's allocator selection is process-wide. */
#include "ebp_core.h"
#include <jansson.h>
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t allocation_count, fail_at;
static int failure_triggered;

static void *fault_malloc(size_t size) {
    if (++allocation_count == fail_at) {
        failure_triggered = 1;
        return NULL;
    }
    return malloc(size);
}

static const char reproduction[] =
    "{\"fingerprint\":\"x\",\"signingKeyType\":\"dilithium\","
    "\"encryptionKeyType\":\"kyber\",\"signingKey\":\"a\",\"encryptionKey\":\"b\"}";

static void check_reproduction(void) {
    json_error_t error;
    allocation_count = 0; fail_at = 8; failure_triggered = 0;
    json_t *value = json_loadb(reproduction, sizeof(reproduction) - 1,
        JSON_DECODE_ANY | JSON_REJECT_DUPLICATES | JSON_ALLOW_NUL | JSON_DECODE_INT_AS_REAL, &error);
    assert(failure_triggered && value == NULL);
    assert(json_error_code(&error) == json_error_out_of_memory);
    json_decref(value);
}

static size_t sweep(const char *input, int valid, int flags) {
    json_error_t error;
    json_t *value;
    size_t count, tested = 0;
    allocation_count = 0; fail_at = SIZE_MAX; failure_triggered = 0;
    value = json_loadb(input, strlen(input), flags, &error);
    count = allocation_count;
    assert((value != NULL) == valid);
    json_decref(value);
    for (size_t i = 1; i <= count; i++) {
        allocation_count = 0; fail_at = i; failure_triggered = 0;
        value = json_loadb(input, strlen(input), flags, &error);
        if (failure_triggered) {
            /* An allocation failed: never accept a truncated valid token. */
            assert(value == NULL);
            tested++;
        } else {
            assert((value != NULL) == valid);
        }
        json_decref(value);
    }
    return tested;
}

static void sweep_core_api(void) {
    uint8_t *out, *expected; size_t len, count, expected_len;
    allocation_count = 0; fail_at = SIZE_MAX; failure_triggered = 0;
    assert(ebp_json_canonical((const uint8_t *)reproduction, sizeof(reproduction) - 1, &out, &len));
    expected = out; expected_len = len; count = allocation_count;
    for (size_t i = 1; i <= count; i++) {
        allocation_count = 0; fail_at = i; failure_triggered = 0;
        out = NULL; len = 0;
        int ok = ebp_json_canonical((const uint8_t *)reproduction, sizeof(reproduction) - 1, &out, &len);
        if (ok) assert(out && len == expected_len && memcmp(out, expected, len) == 0);
        else assert(!out && !len && failure_triggered);
        ebp_free(out);
    }
    ebp_free(expected);
}

int main(void) {
    static const struct { const char *text; int valid; } cases[] = {
        {reproduction, 1},
        {"{\"long_key_that_forces_buffer_growth\":\"a long value with \\\"quotes\\\", \\uD83D\\uDE00 and \\\\ escapes\"}", 1},
        {"{\"x\": 1234567890123456789012345678901234567890}", 1},
        {"{\"x\": -12345678901234567890.12345678901234567890e-00000000000000000001}", 1},
        {"[true,false,null,\"snowman ☃ and emoji 😀\"]", 1},
        {"{\"x\":\"a long unclosed string and escape \\uD800\"}", 0},
        {"[trueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee]", 0},
        {"{\"x\": 12345678901234567890.12345678901234567890e+}", 0},
        {"{\"same\": 1, \"same\": 2}", 0},
        {"[é]", 0},
    };
    const int flags = JSON_DECODE_ANY | JSON_REJECT_DUPLICATES | JSON_ALLOW_NUL | JSON_DECODE_INT_AS_REAL;
    size_t tested = 0;
    json_set_alloc_funcs(fault_malloc, free);
    check_reproduction();
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++)
        tested += sweep(cases[i].text, cases[i].valid, flags);
    /* Also cover Jansson's integer scanning path. */
    tested += sweep("{\"x\":1234567890123456789}", 1, JSON_REJECT_DUPLICATES);
    sweep_core_api();
    json_set_alloc_funcs(malloc, free);
    printf("Checked %zu Jansson allocation-failure positions\n", tested);
    return 0;
}
