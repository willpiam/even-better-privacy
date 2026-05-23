---
title: "NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption"
source: "https://www.nist.gov/news-events/news/2025/03/nist-selects-hqc-fifth-algorithm-post-quantum-encryption"
author:
  - "[[Chad Boutin]]"
published: 2025-03-11
created: 2026-05-20
description: "The new algorithm will serve as a backup for the general encryption needed to protect data from quantum computers developed in the future."
tags:
  - "clippings"
---
- NIST has chosen a new algorithm for post-quantum encryption called HQC, which will serve as a backup for ML-KEM, the main algorithm for general encryption.
- HQC is based on different math than ML-KEM, which could be important if a weakness were discovered in ML-KEM.
- NIST plans to issue a draft standard incorporating the HQC algorithm in about a year, with a finalized standard expected in 2027.

![Collage illustration of servers, laptops and phones is divided into left "Old Encryption Standards" and right "New Encryption Standards."](https://www.nist.gov/sites/default/files/styles/960_x_960_limit/public/images/2023/08/22/PQC_Algo_Pre-standardization-vid.jpg?itok=tpUkOrYt)

Credit: J. Wang/NIST and Shutterstock

Last year, NIST [standardized a set of encryption algorithms](https://www.nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards "NIST Releases First 3 Finalized Post-Quantum Encryption Standards ") that can keep data secure from a cyberattack by a future quantum computer. Now, NIST has [selected a backup algorithm](https://csrc.nist.gov/pubs/ir/8545/final) that can provide a second line of defense for the task of general encryption, which safeguards internet traffic and stored data alike.

Encryption protects sensitive electronic information, including internet traffic and medical and financial records, as well as corporate and national security secrets. But a sufficiently powerful quantum computer, if one is ever built, would be able to break that defense. NIST has been working for more than eight years on encryption algorithms that even a quantum computer cannot break.

Last year, NIST [published an encryption standard](https://csrc.nist.gov/pubs/fips/203/final) based on a quantum-resistant algorithm called ML-KEM. The new algorithm, called HQC, will serve as a backup defense in case quantum computers are someday able to crack ML-KEM. Both these algorithms are designed to protect stored information as well as data that travels across public networks.

## What is post-quantum cryptography? Read an explainer.

HQC is not intended to take the place of ML-KEM, which will remain the recommended choice for general encryption, said Dustin Moody, a mathematician who heads NIST’s Post-Quantum Cryptography project.

“Organizations should continue to migrate their encryption systems to the standards we finalized in 2024,” he said. “We are announcing the selection of HQC because we want to have a backup standard that is based on a different math approach than ML-KEM. As we advance our understanding of future quantum computers and adapt to emerging cryptanalysis techniques, it’s essential to have a fallback in case ML-KEM proves to be vulnerable.”

## Encryption Based on Two Math Problems

Encryption systems rely on complex math problems that conventional computers find difficult or impossible to solve. A sufficiently capable quantum computer, though, would be able to sift through a vast number of potential solutions to these problems very quickly, thereby defeating current encryption.

While the ML-KEM algorithm is built around a mathematical idea called structured lattices, the HQC algorithm is built around another concept called [error-correcting codes](https://www.ams.org/publicoutreach/feature-column/fcarc-errors6), which have been used in information security for decades. Moody said that HQC is a lengthier algorithm than ML-KEM and therefore demands more computing resources. However its clean and secure operation convinced reviewers that it would make a worthy backup choice.

*“Organizations should continue to migrate their encryption systems to the standards NIST finalized in 2024. We are announcing the selection of HQC because we want to have a backup standard that is based on a different math approach than ML-KEM.” —Dustin Moody, NIST mathematician and project head*

## Present and Future Standards

HQC is the latest algorithm chosen by NIST’s [Post-Quantum Cryptography project](https://csrc.nist.gov/projects/post-quantum-cryptography), which has overseen efforts since 2016 to head off potential threats from quantum computers. HQC will take its place alongside the [four algorithms NIST selected previously](https://www.nist.gov/news-events/news/2022/07/nist-announces-first-four-quantum-resistant-cryptographic-algorithms "NIST Announces First Four Quantum-Resistant Cryptographic Algorithms"). Three of those algorithms have been [incorporated into finished standards](https://www.nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards "NIST Releases First 3 Finalized Post-Quantum Encryption Standards "), including ML-KEM, which forms the core of the standard called FIPS 203.

The other two finished standards, [FIPS 204](https://csrc.nist.gov/pubs/fips/204/final) and [FIPS 205](https://csrc.nist.gov/pubs/fips/205/final), contain digital signature algorithms, a kind of “electronic fingerprint” that authenticates the identity of a sender, such as when remotely signing documents. The three finished standards are ready for use, and organizations have already started integrating them into their information systems to future-proof them.

A draft of the fourth standard, built around the FALCON algorithm, also concerns digital signatures and will be released shortly as FIPS 206.

HQC is the only algorithm to be standardized from NIST's [fourth round](https://csrc.nist.gov/projects/post-quantum-cryptography/round-4-submissions) of candidates, which initially included four algorithms meriting further study. NIST has [released a report](https://csrc.nist.gov/pubs/ir/8545/final) summarizing each of these four candidate algorithms and detailing why HQC was selected.

NIST plans to release a draft standard built around HQC for public comment in about a year. Following a 90-day comment period, NIST will address the comments and finalize the standard for release in 2027.

## Draft Guidance for KEM Algorithms

One thing HQC has in common with ML-KEM is that they are both what experts call “key encapsulation mechanisms,” or KEMs. A KEM is used over a public network as a sort of first handshake between two parties that want to exchange confidential information.

NIST has recently published draft guidance for implementing KEM algorithms. This guidance, [*Recommendations for Key Encapsulation Mechanisms* (NIST Special Publication 800-227)](https://csrc.nist.gov/pubs/sp/800/227/ipd), describes the basic definitions, properties and applications of KEMs. It also provides recommendations for implementing and using KEMs in a secure manner. NIST hosted a virtual [Workshop on Guidance for KEMs](https://csrc.nist.gov/events/2025/workshop-on-guidance-for-kems) in February, and the draft was open for public comment until March 7, 2025.

Released March 11, 2025, Updated March 20, 2025