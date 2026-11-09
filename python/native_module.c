#define PY_SSIZE_T_CLEAN
#include <Python.h>

/* The public Python API calls the C library through ctypes. This module makes
 * the same library available in an installed platform-specific wheel. */
static struct PyModuleDef module = {
    PyModuleDef_HEAD_INIT, "_native", NULL, -1, NULL, NULL, NULL, NULL, NULL
};
PyMODINIT_FUNC PyInit__native(void) { return PyModule_Create(&module); }
