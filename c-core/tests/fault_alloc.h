#ifndef EBP_TEST_FAULT_ALLOC_H
#define EBP_TEST_FAULT_ALLOC_H

#include <stdlib.h>

void *ebp_test_malloc(size_t size);
void *ebp_test_calloc(size_t count, size_t size);
void *ebp_test_realloc(void *ptr, size_t size);

/* Instrument project sources, without replacing allocations inside the
 * independently built OpenSSL archive. */
#define malloc ebp_test_malloc
#define calloc ebp_test_calloc
#define realloc ebp_test_realloc

#endif
