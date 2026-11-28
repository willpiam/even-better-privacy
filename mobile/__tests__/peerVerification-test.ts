import {Identity} from '../../core/Identity';
import {KyberEncryptionKey} from '../../core/Kyber';
import {SphincsSigningKey} from '../../core/Sphincs';
import {
  createVerificationOffer,
  endorsementId,
  parseEndorsement,
  parseVerificationOffer,
  signEndorsement,
  signVerificationProof,
  verificationCode,
  verificationSession,
  verifyPeerProof,
  withdrawEndorsement,
} from '../../core/PeerVerification';
import {ContactQrScanner} from '../src/services/contactQr';
import {MAX_NFC_PAYLOAD_BYTES} from '../src/services/contactNfc';
import {
  decodeNfcVerification,
  encodeVerificationFrames,
  VerificationScanner,
} from '../src/services/verificationTransfer';

const alice = new Identity('dilithium', 'kyber');
const bob = new Identity('dilithium', 'kyber');
const aliceOffer = createVerificationOffer(alice.summary, 'Alice');
const bobOffer = createVerificationOffer(bob.summary, 'Bób 🦊');
const bobProof = signVerificationProof(bob, bobOffer, aliceOffer);

test('both phones compare the same code and prove possession with QR and NFC', () => {
  const qr = encodeVerificationFrames('offer', bobOffer);
  const scanner = new VerificationScanner('offer');
  const results = [...qr].reverse().map(frame => scanner.add(frame));
  expect(parseVerificationOffer(results.at(-1)!.data!)).toEqual(bobOffer);
  expect(() => new ContactQrScanner().add(qr[0])).toThrow();

  const aliceProof = signVerificationProof(alice, aliceOffer, bobOffer);
  const proofFrames = encodeVerificationFrames('proof', aliceProof);
  const payload = proofFrames.join('\n');
  expect(payload.length).toBeLessThanOrEqual(MAX_NFC_PAYLOAD_BYTES);
  expect(
    verifyPeerProof(
      decodeNfcVerification('proof', payload),
      bobOffer,
      aliceOffer,
    ),
  ).toEqual(aliceProof);
  expect(
    verifyPeerProof(JSON.stringify(bobProof), aliceOffer, bobOffer),
  ).toEqual(bobProof);
  const code = verificationCode(verificationSession(aliceOffer, bobOffer));
  expect(code).toMatch(/^[A-F0-9]{4}( [A-F0-9]{4}){7}$/);
  expect(verificationCode(verificationSession(bobOffer, aliceOffer))).toBe(
    code,
  );
  expect(() =>
    decodeNfcVerification('proof', proofFrames.slice(1).join('\n')),
  ).toThrow(/incomplete/);
  expect(() => new VerificationScanner('offer').add(proofFrames[0])).toThrow(
    /offer/,
  );
});

test('a proof is bound to the exact fingerprints, nonces, and offers', () => {
  const raw = JSON.stringify(bobProof);
  expect(() =>
    verifyPeerProof(
      raw,
      createVerificationOffer(alice.summary, 'Alice'),
      bobOffer,
    ),
  ).toThrow();
  expect(() =>
    verifyPeerProof(raw, aliceOffer, {...bobOffer, name: 'Someone else'}),
  ).toThrow();
  expect(() => verifyPeerProof(raw, bobOffer, aliceOffer)).toThrow();
  expect(() =>
    verificationSession(aliceOffer, {...aliceOffer, name: 'Different alias'}),
  ).toThrow();
  expect(() =>
    parseVerificationOffer(
      JSON.stringify({
        ...bobOffer,
        identity: {
          ...bobOffer.identity,
          fingerprint: aliceOffer.identity.fingerprint,
        },
      }),
    ),
  ).toThrow(/fingerprint/);
  const other = encodeVerificationFrames('offer', {...bobOffer, name: 'Other'});
  const original = encodeVerificationFrames('offer', bobOffer);
  const scanner = new VerificationScanner('offer');
  scanner.add(original[0]);
  expect(() => scanner.add(other[1])).toThrow(/different exchanges/);
});

test('a third party can verify an exact claim and an issuer-only withdrawal offline', () => {
  const bundle = signEndorsement(alice, aliceOffer, bobOffer, bobProof, 'Bób');
  const certificate = parseEndorsement(JSON.stringify(bundle));
  expect(certificate).toEqual(bundle);
  expect(certificate.endorsement.name).toBe('Bób');
  expect(() =>
    parseEndorsement(
      JSON.stringify({
        ...bundle,
        endorsement: {...bundle.endorsement, name: 'Someone else'},
      }),
    ),
  ).toThrow(/signature/);
  expect(() =>
    parseEndorsement(JSON.stringify({...bundle, subject: aliceOffer.identity})),
  ).toThrow(/claim/);
  expect(() => withdrawEndorsement(bob, bundle)).toThrow(/Only the identity/);

  const withdrawn = withdrawEndorsement(alice, bundle);
  expect(parseEndorsement(JSON.stringify(withdrawn))).toEqual(withdrawn);
  expect(withdrawn.withdrawal?.endorsementId).toBe(
    endorsementId(bundle.endorsement),
  );
  const another = signEndorsement(alice, aliceOffer, bobOffer, bobProof, 'Bób');
  expect(() =>
    parseEndorsement(
      JSON.stringify({...another, withdrawal: withdrawn.withdrawal}),
    ),
  ).toThrow(/withdrawal/);
});

test('QR and signed files handle the largest supported SLH-DSA signatures', () => {
  const slh = new Identity('sphincs', 'kyber', {
    keys: {
      signingKey: new SphincsSigningKey('slh_dsa_sha2_256f'),
      encryptionKey: new KyberEncryptionKey('ml_kem1024'),
    },
  });
  const offer = createVerificationOffer(slh.summary, 'SLH');
  const proof = signVerificationProof(slh, offer, aliceOffer);
  const frames = encodeVerificationFrames('proof', proof);
  expect(frames.join('\n').length).toBeGreaterThan(MAX_NFC_PAYLOAD_BYTES);
  const scanner = new VerificationScanner('proof');
  const result = frames.map(frame => scanner.add(frame)).at(-1);
  expect(verifyPeerProof(result!.data!, aliceOffer, offer)).toEqual(proof);
  const aliceProof = signVerificationProof(alice, aliceOffer, offer);
  const bundle = signEndorsement(slh, offer, aliceOffer, aliceProof, 'Alice');
  const withdrawn = withdrawEndorsement(slh, bundle);
  expect(parseEndorsement(JSON.stringify(withdrawn))).toEqual(withdrawn);
});
