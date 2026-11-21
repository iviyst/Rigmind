// Public key for the signed threat list published by github.com/iviyst/rigmind-intel.
// Generate the key pair once with `node make-keys.mjs` (in the rigmind-intel repo), put the PRIVATE key in the
// rigmind-intel repo's Actions secrets (INTEL_SIGNING_KEY) and paste the PUBLIC key below.
// A public key is safe to ship: it can only check signatures, not make them.
export const INTEL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
REPLACE_WITH_YOUR_PUBLIC_KEY
-----END PUBLIC KEY-----`;

export const INTEL_URL = "https://github.com/iviyst/rigmind-intel/releases/latest/download/intel.json.gz";
export const INTEL_SIG_URL = "https://github.com/iviyst/rigmind-intel/releases/latest/download/intel.json.gz.sig";
