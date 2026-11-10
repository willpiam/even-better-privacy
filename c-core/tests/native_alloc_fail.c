/* Exercise cleanup when each C-core allocation fails in turn. Compile with
 * -include tests/fault_alloc.h and run with leak detection. */
#include "ebp_core.h"
#include <jansson.h>
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#undef malloc
#undef calloc
#undef realloc

static size_t fail_at, allocations;
static int inject;
void *ebp_test_malloc(size_t n) { if (inject && ++allocations == fail_at) return NULL; return malloc(n); }
void *ebp_test_calloc(size_t n, size_t s) { if (inject && ++allocations == fail_at) return NULL; return calloc(n,s); }
void *ebp_test_realloc(void *p, size_t n) { if (inject && ++allocations == fail_at) return NULL; return realloc(p,n); }
static ebp_identity *alice, *bob;
static uint8_t *pub, *storage, *file_json, *email_json, *packet;
static size_t pub_len, storage_len, file_len, email_len, packet_len;
static char alice_fp[65], bob_fp[65];
static const uint8_t text[]="hello", manifest[]="[{\"attachmentId\":\"a\",\"ciphertextSha256\":\"aa\"}]", recipients[]="[\"a\",\"b\"]";
static const uint8_t fields[]="{\"fingerprint\":\"fp\",\"message\":\"hello\",\"messageHash\":\"abc\",\"salt\":\"s\",\"signature\":\"sig\"}", payload[]="{\"type\":\"ebp-signed-message\",\"version\":2}", entries[]="[{\"fingerprint\":\"a\",\"kemCiphertext\":\"b\",\"keyWrapNonce\":\"c\",\"wrappedContentKey\":\"d\"}]";
static const uint8_t state[]="{\"fingerprint\":\"x\",\"signingKeyType\":\"dilithium\",\"encryptionKeyType\":\"kyber\",\"signingKey\":\"a\",\"encryptionKey\":\"b\"}", detail[]="{\"a\":[\"b\",\"c\"]}", key[32]={0}, salt[16]={0};
static void get_fp(const uint8_t *json, size_t len, char out[65]) {
    json_t *obj=json_loadb((const char *)json,len,0,NULL); assert(obj);
    const char *s=json_string_value(json_object_get(obj,"fingerprint")); assert(s && strlen(s)==64);
    memcpy(out,s,65); json_decref(obj);
}
static int op(unsigned i) {
    uint8_t *out=NULL,*out2=NULL,*out3=NULL; size_t n=0,n2=0,n3=0; ebp_identity *loaded=NULL;
    const ebp_identity *members[]={bob}; int ok=0;
    switch(i) {
    case 0: ok=ebp_json_canonical(state,sizeof(state)-1,&out,&n); break;
    case 1: ok=ebp_identity_state_from_external(state,sizeof(state)-1,detail,sizeof(detail)-1,&out,&n); break;
    case 2: ok=ebp_payload_build("ebp-signed-message",fields,sizeof(fields)-1,&out,&n); break;
    case 3: ok=ebp_payload_parse(payload,sizeof(payload)-1,&out,&n); break;
    case 4: ok=ebp_payload_armor(payload,sizeof(payload)-1,&out,&n); break;
    case 5: ok=ebp_multi_recipient_entries_parse(entries,sizeof(entries)-1,&out,&n); break;
    case 6: ok=ebp_multi_normalize(recipients,sizeof(recipients)-1,manifest,sizeof(manifest)-1,&out,&n); break;
    case 7: ok=ebp_multi_envelope(text,sizeof(text)-1,recipients,sizeof(recipients)-1,manifest,sizeof(manifest)-1,NULL,0,&out,&n); break;
    case 8: ok=ebp_file_envelope_create(text,sizeof(text)-1,(uint8_t*)"name",4,(uint8_t*)"mime",4,&out,&n); break;
    case 9: ok=ebp_file_envelope_parse(file_json,file_len,&out,&n,&out2,&n2,&out3,&n3); break;
    case 10: ok=ebp_email_attachment_create(text,sizeof(text)-1,(uint8_t*)"name",4,(uint8_t*)"mime",4,(uint8_t*)"id",2,NULL,0,&out,&n); break;
    case 11: ok=ebp_email_attachment_parse(email_json,email_len,&out,&n,&out2,&n2); break;
    case 12: ok=ebp_identity_public_export(alice,0,1,1,&out,&n); break;
    case 13: ok=ebp_identity_from_public_json(pub,pub_len,&loaded); break;
    case 14: ok=ebp_identity_from_embedded_json(pub,pub_len,alice_fp,&loaded); break;
    case 15: ok=ebp_identity_store_with_key(alice,key,salt,&out,&n); break;
    case 16: ok=ebp_identity_load_with_key(storage,storage_len,key,&loaded); break;
    case 17: ok=ebp_detail_proof_create(alice,(uint8_t*)"name",4,text,sizeof(text)-1,1,1,&out,&n); break;
    case 18: ok=ebp_revocation_create(alice,1,1,1,NULL,0,(uint8_t*)"name",4,&out,&n); break;
    case 19: ok=ebp_hierarchy_create(alice,bob,1,0,NULL,0,(uint8_t*)"salt",4,&out,&n); break;
    case 20: ok=ebp_identity_sign_encrypt_many(alice,members,1,text,sizeof(text)-1,manifest,sizeof(manifest)-1,key,&out,&n); break;
    case 21: ok=ebp_identity_decrypt_verify_many(bob,alice,packet,packet_len,&out,&n); break;
    case 22: ok=ebp_hierarchy_unsigned(alice_fp,bob_fp,1,0,NULL,0,(uint8_t*)"salt",4,&out,&n); break;
    case 23: ok=ebp_revocation_unsigned(1,alice_fp,1,1,NULL,0,(uint8_t*)"name",4,&out,&n); break;
    default: abort();
    }
    if (!ok) assert(!out && !out2 && !out3 && !loaded);
    ebp_secure_free(out,n); ebp_secure_free(out2,n2); ebp_secure_free(out3,n3); ebp_identity_free(loaded); return ok;
}
int main(void) {
    size_t fault_positions=0;
    /* Jansson deliberately undefines allocator macros in memory.c, so set its
     * private allocator explicitly to include JSON allocations in the sweep. */
    json_set_alloc_funcs2(ebp_test_malloc,ebp_test_realloc,free);
    assert(ebp_identity_create(0,&alice)); assert(ebp_identity_create(0,&bob));
    assert(ebp_identity_public_json(alice,&pub,&pub_len)); get_fp(pub,pub_len,alice_fp);
    uint8_t *other=NULL; size_t other_len=0;
    assert(ebp_identity_public_json(bob,&other,&other_len)); get_fp(other,other_len,bob_fp); ebp_free(other);
    assert(ebp_identity_store_with_key(alice,key,salt,&storage,&storage_len));
    assert(ebp_file_envelope_create(text,sizeof(text)-1,(uint8_t*)"name",4,(uint8_t*)"mime",4,&file_json,&file_len));
    assert(ebp_email_attachment_create(text,sizeof(text)-1,(uint8_t*)"name",4,(uint8_t*)"mime",4,(uint8_t*)"id",2,NULL,0,&email_json,&email_len));
    const ebp_identity *members[]={bob};
    assert(ebp_identity_sign_encrypt_many(alice,members,1,text,sizeof(text)-1,manifest,sizeof(manifest)-1,key,&packet,&packet_len));
    for(unsigned i=0;i<24;i++) {
        inject=1; fail_at=SIZE_MAX; allocations=0; assert(op(i)); size_t total=allocations; inject=0;
        fault_positions+=total;
        for(size_t j=1;j<=total;j++) { allocations=0; fail_at=j; inject=1; (void)op(i); inject=0; }
    }
    ebp_identity_free(alice); ebp_identity_free(bob); ebp_free(pub); ebp_free(storage); ebp_free(file_json); ebp_free(email_json); ebp_secure_free(packet,packet_len);
    printf("Checked %zu C-core allocation failure positions across 24 operations\n",fault_positions);
    return 0;
}
