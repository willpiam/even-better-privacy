#ifndef EBP_JSON_COMPAT_H
#define EBP_JSON_COMPAT_H
#include <jansson.h>
#include <stdint.h>
/* JSON.stringify uses lowercase hexadecimal digits in Unicode escapes. */
void ebp_json_lowercase_escapes(char *json);
int ebp_json_is_safe_integer(const json_t *value);
int64_t ebp_json_safe_integer(const json_t *value);
#endif
