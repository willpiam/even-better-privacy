/* Standalone reproducer for an upstream Jansson parser allocation-failure bug.
 * This intentionally triggers an out-of-bounds read with affected versions and
 * is not part of the passing test suite. Example with development headers:
 *   cc -g -fsanitize=address c-core/tests/jansson_alloc_failure_repro.c \
 *      -ljansson -o /tmp/jansson_alloc_failure_repro
 *   /tmp/jansson_alloc_failure_repro
 * Building Jansson itself with AddressSanitizer gives a more precise report.
 */
#include <jansson.h>
#include <stddef.h>
#include <stdlib.h>

static size_t allocation_count;

static void *fail_eighth_allocation(size_t size) {
    if (++allocation_count == 8) return NULL;
    return malloc(size);
}

int main(void) {
    static const char json[] =
        "{\"fingerprint\":\"x\",\"signingKeyType\":\"dilithium\","
        "\"encryptionKeyType\":\"kyber\",\"signingKey\":\"a\",\"encryptionKey\":\"b\"}";
    json_t *value;
    json_set_alloc_funcs(fail_eighth_allocation, free);
    value = json_loadb(json, sizeof(json) - 1,
                       JSON_DECODE_ANY | JSON_REJECT_DUPLICATES |
                       JSON_ALLOW_NUL | JSON_DECODE_INT_AS_REAL, NULL);
    json_decref(value);
    return 0;
}
