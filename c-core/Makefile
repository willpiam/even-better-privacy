CC ?= cc
PKG_CONFIG ?= pkg-config
CFLAGS ?= -O2 -Wall -Wextra -Werror -std=c11
CPPFLAGS += -Iinclude -Ivendor/ryu -Ivendor/jansson/src -DHAVE_CONFIG_H $(shell $(PKG_CONFIG) --cflags libcrypto 2>/dev/null)
# Hide the static OpenSSL symbols so an OpenSSL already loaded by the host
# process cannot replace the version selected when this library was built.
comma := ,
OPENSSL_FLAGS := $(shell $(PKG_CONFIG) --libs --static libcrypto 2>/dev/null)
OPENSSL_STATIC := $(subst -lcrypto,-Wl$(comma)-Bstatic -lcrypto -Wl$(comma)-Bdynamic,$(OPENSSL_FLAGS))
LDLIBS += $(OPENSSL_STATIC) -Wl,--exclude-libs,ALL -largon2 -lutf8proc -lm
CORE_SOURCES := src/ebp_core.c src/pq.c src/hd.c src/fingerprint.c src/envelope.c src/kem_cipher.c src/mnemonic.c src/multi.c src/identity.c src/payload.c src/proof.c src/file_payload.c src/multi_envelope.c src/json_compat.c src/jcs.c vendor/ryu/ryu/d2s.c
JANSSON_SOURCES := $(wildcard vendor/jansson/src/*.c)
SOURCES := $(CORE_SOURCES) $(JANSSON_SOURCES)
HEADERS := include/ebp_core.h src/bip39_words.inc src/json_compat.h src/jcs.h $(wildcard vendor/jansson/src/*.h)
VISIBILITY := -fvisibility=hidden
SANITIZE := -fsanitize=address,undefined -fno-omit-frame-pointer

.PHONY: all clean test sanitize check-openssl
all: libebp_core.so
check-openssl:
	@$(PKG_CONFIG) --atleast-version=3.5.0 libcrypto && test "$(filter -lcrypto,$(OPENSSL_FLAGS))" = "-lcrypto" || { echo "OpenSSL 3.5+ development files and pkg-config are required" >&2; exit 1; }
libebp_core.so: $(SOURCES) $(HEADERS) | check-openssl
	$(CC) $(CPPFLAGS) $(CFLAGS) $(VISIBILITY) -fPIC -shared -o $@ $(SOURCES) $(LDFLAGS) $(LDLIBS)
test: all
	mkdir -p build
	$(CC) $(CPPFLAGS) $(CFLAGS) -o build/native_test tests/native_test.c -L. -Wl,-rpath,$(CURDIR) -lebp_core $(LDFLAGS) $(LDLIBS)
	./build/native_test
	PYTHONPATH=../python python3 -m unittest discover -s tests -v
sanitize: check-openssl
	mkdir -p build
	$(CC) $(CPPFLAGS) $(CFLAGS) $(VISIBILITY) $(SANITIZE) -o build/native_sanitize tests/native_test.c $(SOURCES) $(LDFLAGS) $(LDLIBS)
	./build/native_sanitize
	$(CC) $(CPPFLAGS) $(CFLAGS) $(VISIBILITY) $(SANITIZE) -o build/native_fuzz tests/native_fuzz.c $(SOURCES) $(LDFLAGS) $(LDLIBS)
	./build/native_fuzz
	$(CC) $(CPPFLAGS) $(CFLAGS) $(VISIBILITY) $(SANITIZE) -include tests/fault_alloc.h -o build/native_alloc_fail tests/native_alloc_fail.c $(SOURCES) $(LDFLAGS) $(LDLIBS)
	ASAN_OPTIONS=$${ASAN_OPTIONS:-detect_leaks=1:halt_on_error=1} ./build/native_alloc_fail
	$(CC) $(CPPFLAGS) $(CFLAGS) $(VISIBILITY) $(SANITIZE) -o build/jansson_alloc_failure_test tests/jansson_alloc_failure_test.c $(SOURCES) $(LDFLAGS) $(LDLIBS)
	ASAN_OPTIONS=$${ASAN_OPTIONS:-detect_leaks=1:halt_on_error=1} ./build/jansson_alloc_failure_test
clean:
	rm -f libebp_core.so
	rm -rf build
