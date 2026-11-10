#include "json_compat.h"
#include <stddef.h>
#include <math.h>
#include <string.h>

void ebp_json_lowercase_escapes(char *json) {
    size_t len; int in_string=0;
    if (!json) return;
    len=strlen(json);
    for (size_t i=0; i<len; i++) {
        if (json[i]=='"') { in_string=!in_string; continue; }
        if (!in_string || json[i]!='\\' || i+1>=len) continue;
        if (json[i+1]=='u' && i+5<len) {
            for (size_t j=i+2; j<=i+5; j++) if (json[j]>='A' && json[j]<='F') json[j]=(char)(json[j]-'A'+'a');
            i+=5;
        } else i++;
    }
}
int ebp_json_is_safe_integer(const json_t *value) {
    const int64_t limit=INT64_C(9007199254740991);
    if (json_is_integer(value)) return json_integer_value(value)>=-limit && json_integer_value(value)<=limit;
    if (json_is_real(value)) {
        double d=json_real_value(value);
        return isfinite(d) && d>=-(double)limit && d<=(double)limit && floor(d)==d;
    }
    return 0;
}
int64_t ebp_json_safe_integer(const json_t *value) {
    if (!ebp_json_is_safe_integer(value)) return 0;
    return json_is_integer(value)?(int64_t)json_integer_value(value):(int64_t)json_real_value(value);
}
