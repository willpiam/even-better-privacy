#ifndef EBP_JSON_COMPAT_H
#define EBP_JSON_COMPAT_H
/* JSON.stringify uses lowercase hexadecimal digits in Unicode escapes. */
void ebp_json_lowercase_escapes(char *json);
#endif
