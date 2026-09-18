// background.js
// Platform detection, key storage, and message routing.

const STORAGE_KEYS = {
  PUBLIC_KEY: 'public_key',
  WRAPPED_PRIVATE_KEY: 'wrapped_private_key',
  CONTACTS: 'contacts',
};

function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    if (hostname.includes('facebook.com')) return 'facebook';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('x.com') || hostname.includes('twitter.com')) return 'twitter';
  } catch { /* invalid URL */ }
  return null;
}

async function getContact(contactId) {
  const result = await browser.storage.local.get(STORAGE_KEYS.CONTACTS);
  const contacts = result[STORAGE_KEYS.CONTACTS] || {};
  return contacts[contactId] || null;
}

async function listContacts() {
  const result = await browser.storage.local.get(STORAGE_KEYS.CONTACTS);
  return result[STORAGE_KEYS.CONTACTS] || {};
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    switch (message?.type) {
      case 'DETECT_PLATFORM':
        return { platform: detectPlatform(sender.tab?.url || '') };

      case 'GET_PUBLIC_KEY': {
        const r = await browser.storage.local.get(STORAGE_KEYS.PUBLIC_KEY);
        return { publicKey: r[STORAGE_KEYS.PUBLIC_KEY] || null };
      }

      case 'STORE_KEYS':
        await browser.storage.local.set({
          [STORAGE_KEYS.PUBLIC_KEY]: message.publicKey,
          [STORAGE_KEYS.WRAPPED_PRIVATE_KEY]: message.wrappedPrivateKey,
        });
        return { success: true };

      case 'STORE_CONTACT': {
        const r = await browser.storage.local.get(STORAGE_KEYS.CONTACTS);
        const contacts = r[STORAGE_KEYS.CONTACTS] || {};
        contacts[message.contactId] = {
          publicKey: message.publicKey,
          addedAt: Date.now(),
        };
        await browser.storage.local.set({ [STORAGE_KEYS.CONTACTS]: contacts });
        return { success: true };
      }

      case 'GET_CONTACT':
        return { contact: await getContact(message.contactId) };

      case 'LIST_CONTACTS':
        return { contacts: await listContacts() };

      case 'REMOVE_CONTACT': {
        const r = await browser.storage.local.get(STORAGE_KEYS.CONTACTS);
        const contacts = r[STORAGE_KEYS.CONTACTS] || {};
        delete contacts[message.contactId];
        await browser.storage.local.set({ [STORAGE_KEYS.CONTACTS]: contacts });
        return { success: true };
      }

      default:
        return { error: 'Unknown message type' };
    }
  } catch (err) {
    console.error('[EncryptSocial/background] error', err);
    return { error: String(err?.message || err) };
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const platform = detectPlatform(tab.url);
    if (platform) {
      browser.tabs.sendMessage(tabId, { type: 'PLATFORM_DETECTED', platform })
        .catch(() => { /* content script not ready yet */ });
    }
  }
});