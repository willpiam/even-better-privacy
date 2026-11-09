#include "json_compat.h"
#include <stddef.h>
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
