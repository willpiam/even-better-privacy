import { Identity } from "./core/Identity.ts";

const identity = new Identity('dilithium', 'kyber');
identity.attachDetail('name', 'John Doe');
identity.attachDetail('email', 'john.doe@example.com');
identity.attachDetail('website', 'https://john.doe.com');
identity.attachDetail('bitcoin', 'bc1q6crw4wy7jecs05f4ytz68n6evuzlu7k3cnu7zy');
// const identity = new Identity('sphincs', 'kyber');
console.log(identity.toFingerprint());    
console.log(identity.summary);