CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Werror -std=c11
CPPFLAGS += -Iinclude -Ivendor/ryu
LDLIBS += -lcrypto -largon2 -lutf8proc -ljansson -lm

.PHONY: all clean test sanitize
all: libebp_core.so
libebp_core.so: src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/bip39_words.inc src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/json_compat.h src/jcs.c src/jcs.h vendor/ryu/ryu/d2s.c include/ebp_core.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -fPIC -shared -o $@ src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/jcs.c vendor/ryu/ryu/d2s.c $(LDFLAGS) $(LDLIBS)
test: all
	mkdir -p build
	$(CC) $(CPPFLAGS) $(CFLAGS) -o build/native_test tests/native_test.c -L. -Wl,-rpath,$(CURDIR) -lebp_core $(LDFLAGS) $(LDLIBS)
	./build/native_test
	PYTHONPATH=../python python3 -m unittest discover -s tests -v
sanitize:
	mkdir -p build
	$(CC) $(CPPFLAGS) $(CFLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer -o build/native_sanitize tests/native_test.c src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/jcs.c vendor/ryu/ryu/d2s.c $(LDFLAGS) $(LDLIBS)
	./build/native_sanitize
	$(CC) $(CPPFLAGS) $(CFLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer -o build/native_fuzz tests/native_fuzz.c src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/jcs.c vendor/ryu/ryu/d2s.c $(LDFLAGS) $(LDLIBS)
	./build/native_fuzz
	$(CC) $(CPPFLAGS) $(CFLAGS) -fsanitize=address,undefined -fno-omit-frame-pointer -Wl,--wrap=malloc,--wrap=calloc,--wrap=realloc -o build/native_alloc_fail tests/native_alloc_fail.c src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/jcs.c vendor/ryu/ryu/d2s.c $(LDFLAGS) $(LDLIBS)
	ASAN_OPTIONS=$${ASAN_OPTIONS:-detect_leaks=1:halt_on_error=1} ./build/native_alloc_fail
clean:
	rm -f libebp_core.so
	rm -rf build
