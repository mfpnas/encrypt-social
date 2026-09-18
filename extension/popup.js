// popup.js
const statusEl = document.getElementById('status');
const keyInfoEl = document.getElementById('key-info');

function setStatus(text, type = 'ok') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

async function loadKeyStatus() {
  const result = await browser.storage.local.get(['public_key', 'wrapped_private_key']);
  if (result.public_key) {
    setStatus('Key pair found. Ready to encrypt.', 'ok');
    keyInfoEl.style.display = 'block';
    keyInfoEl.textContent = `Public key: ${result.public_key.slice(0, 32)}…`;
  } else {
    setStatus('No key pair. Generate one to start.', 'warn');
    keyInfoEl.style.display = 'none';
  }
}

document.getElementById('btn-generate').addEventListener('click', async () => {
  setStatus('Generating keys…', 'warn');

  const password = window.prompt(
    'Choose a strong password (at least 8 characters).\n' +
    'You will need it to decrypt. There is no recovery.'
  );
  if (!password || password.length < 8) {
    setStatus('Cancelled or password too short.', 'warn');
    return;
  }

  try {
    const keyPair = await CryptoModule.generateKeyPair();
    const publicKeyBase64 = await CryptoModule.exportPublicKey(keyPair.publicKey);
    const wrapped = await CryptoModule.wrapPrivateKey(keyPair.privateKey, password);

    await browser.runtime.sendMessage({
      type: 'STORE_KEYS',
      publicKey: publicKeyBase64,
      wrappedPrivateKey: wrapped,
    });

    await loadKeyStatus();
    setStatus('Key pair generated and stored ✓', 'ok');
  } catch (err) {
    console.error('[EncryptSocial/popup] error generating keys', err);
    setStatus('Error generating keys: ' + err.message, 'warn');
  }
});

document.getElementById('btn-options').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

loadKeyStatus();