#include "ebp_core.h"
#include <stdint.h>
#include <string.h>
#include <stdlib.h>

static uint32_t polymod_step(uint32_t pre) {
    static const uint32_t gen[] = {0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3};
    uint32_t top = pre >> 25, chk = (pre & 0x1ffffff) << 5;
    for (int i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= gen[i];
    return chk;
}
int ebp_identity_fingerprint_from_leaves(int sphincs, const uint8_t signing_leaf[32],
                                          const uint8_t encryption_leaf[32], char out[65]) {
    const char *hrp = sphincs ? "ebpsk" : "ebpdk";
    static const char alphabet[] = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    uint8_t leaves[64], root[32], words[52];
    uint32_t chk = 1, acc = 0; int bits = 0; size_t count = 0;
    if (!out || !signing_leaf || !encryption_leaf || (sphincs != 0 && sphincs != 1)) return 0;
    memcpy(leaves,signing_leaf,32); memcpy(leaves+32,encryption_leaf,32);
    if (!ebp_sha256(leaves, sizeof(leaves), root)) return 0;
    for (size_t i = 0; i < sizeof(root); i++) {
        acc = (acc << 8) | root[i]; bits += 8;
        while (bits >= 5) { bits -= 5; words[count++] = (uint8_t)((acc >> bits) & 31); }
    }
    if (bits) words[count++] = (uint8_t)((acc << (5-bits)) & 31);
    for (int i=0; i<5; i++) chk = polymod_step(chk) ^ ((uint8_t)hrp[i] >> 5);
    chk = polymod_step(chk);
    for (int i=0; i<5; i++) chk = polymod_step(chk) ^ ((uint8_t)hrp[i] & 31);
    memcpy(out, hrp, 5); out[5] = '1';
    for (size_t i=0; i<count; i++) { chk = polymod_step(chk) ^ words[i]; out[6+i] = alphabet[words[i]]; }
    for (int i=0; i<6; i++) chk = polymod_step(chk);
    chk ^= 1;
    for (int i=0; i<6; i++) out[6+count+i] = alphabet[(chk >> (5*(5-i))) & 31];
    out[6+count+6] = '\0'; return 1;
}

int ebp_identity_fingerprint(int sphincs, const uint8_t *sign, size_t sign_len,
                             const uint8_t *enc, size_t enc_len, char out[65]) {
    uint8_t sign_leaf[32], encryption_leaf[32];
    if (!out || !sign || !enc || !sign_len || !enc_len ||
        !ebp_sha256(sign,sign_len,sign_leaf) || !ebp_sha256(enc,enc_len,encryption_leaf)) return 0;
    return ebp_identity_fingerprint_from_leaves(sphincs,sign_leaf,encryption_leaf,out);
}
int ebp_fingerprint_decode(const char *fingerprint, int *sphincs, uint8_t root[32]) {
    static const char alphabet[]="qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    uint32_t chk=1,acc=0; int bits=0,profile; size_t count=0;
    if (!fingerprint || !sphincs || !root || strlen(fingerprint)!=64 || fingerprint[5]!='1') return 0;
    if (!memcmp(fingerprint,"ebpdk",5)) profile=0;
    else if (!memcmp(fingerprint,"ebpsk",5)) profile=1;
    else return 0;
    for (int i=0;i<5;i++) chk=polymod_step(chk)^((uint8_t)fingerprint[i]>>5);
    chk=polymod_step(chk);
    for (int i=0;i<5;i++) chk=polymod_step(chk)^((uint8_t)fingerprint[i]&31);
    for (size_t i=6;i<64;i++) {
        const char *p=strchr(alphabet,fingerprint[i]); unsigned value;
        if (!p || !fingerprint[i]) return 0;
        value=(unsigned)(p-alphabet); chk=polymod_step(chk)^value;
        if (i<58) {
            acc=(acc<<5)|value; bits+=5;
            if (bits>=8) { bits-=8; if (count>=32) return 0; root[count++]=(uint8_t)(acc>>bits); }
        }
    }
    if (chk!=1 || count!=32 || bits!=4 || (acc&15u)!=0) return 0;
    *sphincs=profile; return 1;
}
int ebp_short_fingerprint(const uint8_t *fingerprint, size_t len, uint8_t **out, size_t *out_len) {
    uint8_t *copy; size_t n;
    if (!out || !out_len) return 0;
    *out=NULL; *out_len=0;
    if (!fingerprint && len) return 0;
    for (size_t i=0;i<len;i++) if (fingerprint[i]>0x7f) return 0;
    n=len<25?len:27; copy=malloc(n?n:1); if (!copy) return 0;
    if (len<25) { if (len) memcpy(copy,fingerprint,len); }
    else { memcpy(copy,fingerprint,12); memcpy(copy+12,"\xe2\x80\xa6",3); memcpy(copy+15,fingerprint+len-12,12); }
    *out=copy; *out_len=n; return 1;
}
