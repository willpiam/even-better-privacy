from setuptools import Extension, find_packages, setup

setup(
    package_dir={"": "python"},
    packages=find_packages("python"),
    ext_modules=[
        Extension(
            "ebp_core._native",
            sources=[
                "python/native_module.c",
                "c-core/src/ebp_core.c",
                "c-core/src/pq.c",
                "c-core/src/hd.c",
                "c-core/src/fingerprint.c",
                "c-core/src/envelope.c",
                "c-core/src/kem_cipher.c",
                "c-core/src/mnemonic.c",
                "c-core/src/multi.c",
                "c-core/src/identity.c",
                "c-core/src/payload.c",
                "c-core/src/proof.c",
                "c-core/src/file_payload.c",
            ],
            include_dirs=["c-core/include"],
            libraries=["crypto", "argon2", "utf8proc", "jansson", "m"],
            extra_compile_args=["-std=c11"],
        )
    ],
)
