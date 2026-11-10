/* Jansson public configuration for supported Linux C11 builds. */
#ifndef JANSSON_CONFIG_H
#define JANSSON_CONFIG_H

#if !defined(__linux__) || (!defined(__GNUC__) && !defined(__clang__))
#error "The bundled Jansson build requires Linux and a GCC-compatible compiler"
#endif

#define JSON_INLINE inline
#define JSON_INTEGER_IS_LONG_LONG 1
#define JSON_HAVE_ATOMIC_BUILTINS 1
#define JSON_HAVE_SYNC_BUILTINS 1
#define JSON_PARSER_MAX_DEPTH 2048

#endif
