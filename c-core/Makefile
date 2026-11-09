CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -Werror -std=c11
CPPFLAGS += -Iinclude
LDLIBS += -lcrypto

.PHONY: all clean test
all: libebp_core.so
libebp_core.so: src/ebp_core.c include/ebp_core.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -fPIC -shared -o $@ src/ebp_core.c $(LDFLAGS) $(LDLIBS)
test: all
	PYTHONPATH=../python python3 -m unittest discover -s tests -v
clean:
	rm -f libebp_core.so
