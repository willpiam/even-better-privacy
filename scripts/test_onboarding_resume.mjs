import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium, expect} from '@playwright/test';

// Run the real signup UI in Chromium with an isolated, mocked payment server.
// No keys, real payments, or running local backend are needed.
const root = new URL('../', import.meta.url);
const server = 'https://keys.example.test';
const domain = 'test.pqpost.com';
const orderId = '123e4567-e89b-42d3-a456-426614174000';
const html = readFileSync(new URL('gui/index.html', root), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]*>/gi, '') + `
  <style>
    .modal-overlay, .onboarding-step {display:none}
    .modal-overlay.active, .onboarding-step.active {display:block}
    .modal-overlay {position:fixed;inset:0;background:white;overflow:auto}
    #password-modal {z-index:100}
    [hidden] {display:none!important}
  </style>
  <script type="module">
    import {initOnboarding, maybeOpenOnboardingOnFirstRun} from '/js/onboarding.js';
    initOnboarding({navigateTo(){}});
    await maybeOpenOnboardingOnFirstRun();
    window.ready = true;
  </script>`;
const browser = await chromium.launch({headless: true});
try {
  const context = await browser.newContext();
  const calls = [];
  let status = 'pending';
  let orderExists = false;
  let signupFails = false;
  const page = await context.newPage();
  await page.exposeFunction('mockApi', async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({path, body});
    if (path.startsWith('/mail/ebp-signup/config')) return {enabled: true, domain};
    if (path.startsWith('/mail/ebp-signup/username')) return {purchasable: true, username: 'alice', usdCents: 500};
    if (path.startsWith('/mail/ebp-payment/config')) return {enabled: true, assets: [{network: 'ethereum-sepolia', symbol: 'ETH'}]};
    if (path === '/publish') return {ok: true};
    if (path === '/mail/ebp-payment/recover') return {orderId: orderExists ? orderId : null};
    if (path === '/mail/ebp-payment/order') {
      orderExists = true;
      return {orderId};
    }
    if (path === '/mail/ebp-payment/status') {
      assert.equal(body.orderId, orderId);
      return {status};
    }
    if (path === '/mail/ebp-signup') {
      if (signupFails) throw new Error('Temporary mailbox failure');
      return {email: `alice@${domain}`, fingerprint: 'fp', connection: {}};
    }
    throw new Error(`Unexpected API call: ${path}`);
  });
  await page.route('https://onboarding.example.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({contentType: 'text/html', body: html});
    if (path === '/js/state.js') return route.fulfill({contentType: 'text/javascript', body:
      `export const DEFAULT_SERVER_URL = ${JSON.stringify(server)};
       export const state = {server: DEFAULT_SERVER_URL, currentIdentity:'Personal', identities:[{name:'Personal'}]};`});
    if (path === '/js/ui.js') return route.fulfill({contentType: 'text/javascript', body:
      'export const api = (...args) => window.mockApi(...args); export function setStatus() {}'});
    if (path === '/js/render.js') return route.fulfill({contentType: 'text/javascript', body:
      'export async function loadAll() {}'});
    if (['/js/onboarding.js', '/js/mail-signup-resume.js', '/js/modals.js'].includes(path)) {
      return route.fulfill({contentType: 'text/javascript', body: readFileSync(new URL(`gui${path}`, root), 'utf8')});
    }
    return route.fulfill({status: 404, body: ''});
  });
  const resume = () => page.getByRole('button', {name: /^Resume email setup: alice@/});
  async function unlock() {
    await expect(page.locator('#password-modal')).toBeVisible();
    await page.fill('#password-modal-input', 'identity-secret');
    await page.click('#password-modal-confirm');
  }
  async function reload() {
    await page.reload();
    await page.waitForFunction(() => window.ready);
  }
  async function saved() {
    return page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('ebp.mail.signup:')));
  }

  await page.goto('https://onboarding.example.test/');
  await page.waitForFunction(() => window.ready);
  await page.click('#identities-open-onboarding');
  await expect(page.locator('#onboarding-use-current')).toBeEnabled();
  await page.click('#onboarding-use-current');
  await page.fill('#onboarding-username', 'alice');
  await expect(page.locator('#onboarding-address-next')).toBeEnabled();
  await page.click('#onboarding-address-next');
  await unlock();
  await expect(page.locator('#onboarding-checkout')).toBeVisible();
  const checkpoint = await saved();
  assert.equal(checkpoint.length, 1);
  assert.equal(JSON.parse(checkpoint[0][1]).identityName, 'Personal');
  assert.equal(JSON.parse(checkpoint[0][1]).orderId, orderId);
  assert.equal(JSON.stringify(checkpoint).includes('identity-secret'), false);

  // Leaving during payment and returning to the same order after a full reload.
  await reload();
  await resume().click();
  await unlock();
  await expect(page.locator('#onboarding-checkout-link')).toHaveAttribute('href', new RegExp(orderId));
  assert.equal(calls.filter(c => c.path === '/mail/ebp-payment/order').length, 1);

  // An expired quote stays recoverable and checking cannot create another order.
  status = 'expired';
  await page.click('#onboarding-retry');
  await expect(page.locator('#onboarding-create-error')).toContainText('Your order is saved');
  await page.click('#onboarding-retry');
  await expect(page.locator('#onboarding-create-error')).toContainText('Your order is saved');
  assert.equal((await saved()).length, 1);
  assert.equal(calls.filter(c => c.path === '/mail/ebp-payment/order').length, 1);

  // Payment on another device, a transient provisioning failure, then retry.
  status = 'confirmed';
  signupFails = true;
  await reload();
  await resume().click();
  await unlock();
  await expect(page.locator('#onboarding-create-error')).toContainText('Temporary mailbox failure');
  assert.equal((await saved()).length, 1);
  signupFails = false;
  await page.click('#onboarding-retry');
  await expect(page.locator('#onboarding-result-email')).toHaveText(`alice@${domain}`);
  assert.equal((await saved()).length, 0);
  assert.equal(calls.filter(c => c.path === '/mail/ebp-payment/order').length, 1);

  // Completion also removes the visible resume entry when setup is reopened.
  await page.click('#onboarding-open-inbox');
  await page.click('#identities-open-onboarding');
  await expect(resume()).toHaveCount(0);
  await reload();
  await expect(page.locator('#onboarding-modal')).not.toBeVisible();

  // The older order-only storage format also offers resume.
  await page.evaluate(({server, orderId}) => {
    localStorage.setItem(`ebp.mail.order:${server}:Old identity:alice`, orderId);
    localStorage.setItem('ebp.mail.signup:damaged', '{');
  }, {server, orderId});
  await reload();
  await expect(resume()).toContainText('Old identity');
  await resume().click();
  await unlock();
  await expect(page.locator('#onboarding-result-email')).toHaveText(`alice@${domain}`);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('ebp.mail.order:'))), false);
  // A failed deletion must not bring completed records back via legacy storage.
  const remaining = await page.evaluate(async ({server, domain, orderId}) => {
    const {savePendingSignup, completeMailboxSignup, pendingSignups} = await import('/js/mail-signup-resume.js');
    const signup = {server, domain, orderId, identityName: 'Personal', username: 'alice'};
    savePendingSignup(localStorage, signup);
    savePendingSignup(localStorage, {...signup, username: 'bob'});
    localStorage.setItem(`ebp.mail.order:${server}:Personal:alice`, orderId);
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => { throw new Error('Delete failed'); };
    try {
      completeMailboxSignup(localStorage, server, 'Personal', `alice@${domain}`);
    } finally {
      Storage.prototype.removeItem = original;
    }
    return pendingSignups(localStorage, server, domain).map(item => item.username);
  }, {server, domain, orderId});
  assert.deepEqual(remaining, ['bob']);
  await context.close();
  console.log('Onboarding resumes the original order across reloads, retains failures/expired orders, and supports older saved orders.');
} finally {
  await browser.close();
}
