// Watch Box privacy lock: Face ID / Touch ID through the browser (WebAuthn, platform authenticator) with a PIN
// fallback. Locks again whenever the app goes to the background.
// Honest limits: this is a lock on the screen, not encryption — the watch data itself stays readable on the phone
// (encrypting it would mean every screen, the backups and the clock's watch list all waiting for an unlock).
import * as store from './store.js';
import { el, openModal, toast } from './ui.js';

const d = () => store.get();
const cfg = () => (d().boxLock ||= { enabled: false });
let unlocked = false;
const subs = [];
export const onLockChange = (fn) => subs.push(fn);
const changed = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

export const lockEnabled = () => !!cfg().enabled;
export const isLocked = () => lockEnabled() && !unlocked;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

export async function biometricsAvailable() {
  try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (e) { return false; }
}

async function registerBiometric() {
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: rand(32), rp: { name: 'Atomic Clock' },
    user: { id: rand(16), name: 'watch-box', displayName: 'Watch Box' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000, attestation: 'none',
  } });
  return b64(cred.rawId);
}

async function checkBiometric() {
  const c = cfg();
  if (!c.credId) return false;
  try {
    const res = await navigator.credentials.get({ publicKey: {
      challenge: rand(32), allowCredentials: [{ type: 'public-key', id: unb64(c.credId) }], userVerification: 'required', timeout: 60000,
    } });
    // The phone only answers after Face ID / Touch ID succeeds; check it answered for our own key.
    return !!res && b64(res.rawId) === c.credId && !!res.response?.authenticatorData;
  } catch (e) { return false; }
}

function pinInput(placeholder = 'PIN') {
  return el('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', class: 'input pin-in', maxlength: 8, placeholder });
}

/** Ask to unlock: Face ID / Touch ID first (if set up), PIN otherwise. */
export function unlock() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok) { unlocked = true; changed(); } resolve(ok); };
    const pin = pinInput('Enter your PIN');
    const err = el('p', { class: 'muted small pin-err' });
    const tryPin = async () => {
      const c = cfg();
      if (!pin.value) return false;
      if (await hashPin(pin.value, c.salt) === c.pinHash) { finish(true); m.close(); return true; }
      err.textContent = 'That PIN isn’t right.'; pin.value = ''; pin.focus(); return false;
    };
    pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
    const bioBtn = cfg().credId ? el('button', { type: 'button', class: 'btn primary wide', onclick: async () => { if (await checkBiometric()) { finish(true); m.close(); } else err.textContent = 'Face ID / Touch ID didn’t work — use your PIN.'; } }, '🔓 Unlock with Face ID / Touch ID') : null;
    const m = openModal({
      title: '🔒 Watch Box is locked', className: 'lock-modal',
      content: [bioBtn, el('label', { class: 'field' }, el('span', {}, bioBtn ? 'Or use your PIN' : 'PIN'), pin), err],
      actions: [{ label: 'Cancel' }, { label: 'Unlock', kind: 'primary', onClick: async () => { await tryPin(); return false; } }],
      onClose: () => finish(false),
    });
    if (bioBtn) setTimeout(() => bioBtn.click(), 250); else setTimeout(() => pin.focus(), 200);
  });
}

export function lockNow() { if (lockEnabled()) { unlocked = false; changed(); } }

/** First-time set-up: a PIN (the fallback), plus Face ID / Touch ID where the phone supports it. */
async function setUp() {
  const bio = await biometricsAvailable();
  const p1 = pinInput('New PIN (4–8 digits)'), p2 = pinInput('Same PIN again');
  const useBio = el('input', { type: 'checkbox', class: 'check', checked: bio, disabled: !bio });
  const err = el('p', { class: 'muted small pin-err' });
  openModal({
    title: 'Lock your Watch Box',
    content: [
      el('p', { class: 'small' }, 'Hide your collection from anyone using your phone. It locks again every time the app goes to the background.'),
      el('label', { class: 'field' }, el('span', {}, 'PIN'), p1), p2,
      el('label', { class: 'field check-field' }, useBio, el('span', {}, bio ? 'Also unlock with Face ID / Touch ID' : 'Face ID / Touch ID isn’t available here — the PIN will be used')),
      el('p', { class: 'muted small' }, 'Please note: this hides the Watch Box on screen. It doesn’t encrypt the data stored on the phone or in backups.'),
      err],
    actions: [{ label: 'Cancel' }, { label: 'Turn on lock', kind: 'primary', onClick: async () => {
      if (!/^\d{4,8}$/.test(p1.value)) { err.textContent = 'Use 4 to 8 digits.'; return false; }
      if (p1.value !== p2.value) { err.textContent = 'The two PINs don’t match.'; return false; }
      const salt = b64(rand(16));
      const c = { enabled: true, salt, pinHash: await hashPin(p1.value, salt), credId: null };
      if (useBio.checked) {
        try { c.credId = await registerBiometric(); } catch (e) { toast('Face ID / Touch ID wasn’t set up — the PIN will be used'); }
      }
      d().boxLock = c; store.save();
      unlocked = true; changed();
      toast('Watch Box lock is on');
    } }],
  });
}

/** The padlock in the Watch Box header. */
export async function padlockTapped() {
  if (!lockEnabled()) { setUp(); return; }
  if (isLocked()) { await unlock(); return; }
  openModal({
    title: '🔒 Watch Box lock',
    content: el('p', { class: 'small' }, `Locked by ${cfg().credId ? 'Face ID / Touch ID with a PIN fallback' : 'PIN'}. It locks itself whenever the app goes to the background.`),
    actions: [
      { label: 'Turn off', kind: 'danger', onClick: () => { setTimeout(async () => { if (await unlock()) { d().boxLock = { enabled: false }; store.save(); changed(); toast('Watch Box lock is off'); } }, 0); } },
      { label: 'Lock now', kind: 'primary', onClick: () => lockNow() },
    ],
  });
}

export function initLock() {
  // Lock whenever the app is hidden (home screen, app switcher, screen off).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lockNow(); });
  window.addEventListener('pagehide', lockNow);
}
