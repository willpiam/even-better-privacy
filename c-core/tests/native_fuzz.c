/* Deterministic malformed-input smoke corpus for sanitizer runs. */
#include "ebp_core.h"
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>

int main(void) {
    uint32_t state=0x12345678u; uint8_t input[512];
    for (size_t iteration=0; iteration<3000; iteration++) {
        size_t len=iteration%sizeof(input), out_len=0, data_len=0, name_len=0, mime_len=0;
        uint8_t *out=NULL,*data=NULL,*name=NULL,*mime=NULL; ebp_identity *identity=NULL;
        for (size_t i=0; i<len; i++) { state=state*1664525u+1013904223u; input[i]=(uint8_t)(state>>24); }
        if (ebp_payload_parse(input,len,&out,&out_len)) ebp_free(out);
        else assert(out==NULL && out_len==0);
        out=NULL; out_len=0;
        if (ebp_multi_envelope(input,len,input,len,input,len,NULL,0,&out,&out_len)) ebp_secure_free(out,out_len);
        else assert(out==NULL && out_len==0);
        out=NULL; out_len=0;
        if (ebp_json_canonical(input,len,&out,&out_len)) ebp_free(out);
        else assert(out==NULL && out_len==0);
        if (ebp_mnemonic_to_entropy(input,len,&data,&data_len)) ebp_secure_free(data,data_len);
        else assert(data==NULL && data_len==0);
        data=NULL; data_len=0;
        if (ebp_file_envelope_parse(input,len,&data,&data_len,&name,&name_len,&mime,&mime_len)) {
            ebp_secure_free(data,data_len); ebp_free(name); ebp_free(mime);
        } else assert(data==NULL && name==NULL && mime==NULL);
        if (ebp_identity_load(input,len,NULL,0,0,&identity)) ebp_identity_free(identity);
        else assert(identity==NULL);
        uint8_t node[64]; int profile=0;
        (void)ebp_hd_derive_path(input,len,input,len,node,&profile);
    }
    return 0;
}
