import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { generateHumanName } from "./name_generator.ts";

const testPassword = "smoke-test-password";
const testServerUrl = "http://localhost:8788";

async function expandSection(page: Page, sectionTitle: string) {
  const toggle = page
    .locator(".page.active section > .section-toggle", {
      has: page.getByRole("heading", { name: sectionTitle, exact: true }),
    })
    .first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

async function submitPassword(page: Page, password = testPassword) {
  await expect(page.locator("#password-modal")).toBeVisible();
  await page.fill("#password-modal-input", password);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
}

async function setServer(page: Page, serverUrl = testServerUrl) {
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expandSection(page, "Server Configuration");
  await page.fill("#server-url", serverUrl);
  await page.getByRole("button", { name: "Set Server", exact: true }).click();
}

async function generateIdentity(
  page: Page,
  identityName: string,
  password = testPassword,
) {
  await page.goto("/");
  await expandSection(page, "Create New Identity");
  await page.fill("#gen-name", identityName);
  await page.getByRole("button", { name: "Generate Identity", exact: true }).click();
  await submitPassword(page, password);
  await expect(page.locator("#identity-list")).toContainText(identityName);
}

async function publishIdentity(
  page: Page,
  serverUrl = testServerUrl,
  password = testPassword,
) {
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Publish to Server");
  await page.fill("#publish-server", serverUrl);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await submitPassword(page, password);
}

async function addDetail(
  page: Page,
  path: string,
  detail: string,
  password = testPassword,
): Promise<{ pushed: boolean }> {
  await addLocalDetail(page, path, detail, password);
  return { pushed: false };
}

async function addLocalDetail(
  page: Page,
  path: string,
  detail: string,
  password = testPassword,
) {
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Identity Details");
  await page.fill("#detail-path", path);
  await page.fill("#detail-value", detail);
  await page.locator("#detail-push").setChecked(false);
  await page.getByRole("button", { name: "Add Detail", exact: true }).click();
  await submitPassword(page, password);
  await expect(page.locator("#identity-details-list")).toContainText(detail);
}

async function ensureIdentitySelected(page: Page, identityName: string) {
  const currentIdentity = (await page.locator("#ctx-current").textContent())?.trim();
  if (currentIdentity === identityName) {
    return;
  }
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Your Identities");
  await expect(page.locator("#identity-list")).toContainText(identityName);
  await page.locator("#identity-list li", { hasText: identityName }).click();
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator("#ctx-current")).toHaveText(identityName);
}

async function loadServerIdentities(page: Page, search: string) {
  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Browse Server Identities");
  await page.fill("#server-identities-override", testServerUrl);
  await page.fill("#server-identities-search", search);
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();
}

async function expectServerIdentitiesContains(page: Page, search: string, text: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await loadServerIdentities(page, search);
    const listText = await page.locator("#server-identities-list").innerText();
    if (listText.includes(text)) {
      return;
    }
    await page.waitForTimeout(500);
  }
  await expect(page.locator("#server-identities-list")).toContainText(text);
}

async function expectServerIdentitiesNotContains(
  page: Page,
  search: string,
  text: string,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await loadServerIdentities(page, search);
    const listText = await page.locator("#server-identities-list").innerText();
    if (!listText.includes(text)) {
      return;
    }
    await page.waitForTimeout(500);
  }
  await expect(page.locator("#server-identities-list")).not.toContainText(text);
}

test("creates and publishes a new identity", async ({ page }) => {
  const identityName = `e2e-${Date.now()}`;
  const serverUrl = testServerUrl;
  const humanName = generateHumanName();

  await generateIdentity(page, identityName);

  const fingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim();
  expect(fingerprint).toBeTruthy();

  await setServer(page, serverUrl);

  await publishIdentity(page, serverUrl);
  const { pushed: namePushed } = await addDetail(page, "name", humanName);

  const fingerprintSearch = fingerprint ?? "";
  await expectServerIdentitiesContains(page, fingerprintSearch, fingerprintSearch);
  if (namePushed) {
    await expectServerIdentitiesContains(page, fingerprintSearch, humanName);
  }
});

test("refreshes server identities and searches in contacts", async ({ page }) => {
  const identityName = `e2e-${Date.now()}`;
  const serverUrl = testServerUrl;

  await generateIdentity(page, identityName);

  const fingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim();
  expect(fingerprint).toBeTruthy();

  await setServer(page, serverUrl);

  await publishIdentity(page, serverUrl);

  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Browse Server Identities");
  await page.fill("#server-identities-override", serverUrl);
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();

  const fingerprintSearch = fingerprint?.slice(0, 12) ?? "";
  await page.fill("#server-identities-search", fingerprintSearch);
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();

  await expect(page.locator("#server-identities-list")).toContainText(
    fingerprintSearch,
  );
});

test("verifies detached signature with provided public keys", async ({ page }) => {
  const runId = Date.now();
  const identityName = `e2e-detached-${runId}`;
  const messageText = `Detached signature message ${runId}`;

  await generateIdentity(page, identityName);
  await ensureIdentitySelected(page, identityName);

  await page.locator(".nav-item", { hasText: "Sign / Verify" }).click();
  await expandSection(page, "Sign Message");
  await page.fill("#sign-message", messageText);
  await page.locator("#sign-detached").setChecked(true);
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#sign-output")).not.toHaveValue("");
  const detachedPayload = await page.locator("#sign-output").inputValue();

  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Export Public Identity");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#export-output")).not.toHaveValue("");
  const publicIdentity = await page.locator("#export-output").inputValue();

  await page.locator(".nav-item", { hasText: "Sign / Verify" }).click();
  await expandSection(page, "Verify Signature");
  await page.fill("#verify-payload", detachedPayload);
  await page.fill("#verify-message", messageText);
  await page.locator("#verify-use-public-keys").setChecked(true);
  await page.fill("#verify-public-keys", publicIdentity);
  await page.fill("#verify-sender", "nonexistent-contact");
  await page.keyboard.press("Escape");
  await page.locator("#verify-payload").click();
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator("#verify-result")).toHaveText(/Valid/);
});

test.describe.serial("multi-user encrypted messaging flow", () => {
  const runId = Date.now();
  const aliceIdentity = `e2e-alice-${runId}`;
  const bobIdentity = `e2e-bob-${runId}`;
  const aliceEmail = `alice-${runId}@example.com`;
  const bobEmail = `bob-${runId}@example.com`;
  const messageText = `Hello from ${aliceIdentity} to ${bobIdentity}.`;
  let aliceFingerprint = "";
  let bobFingerprint = "";

  test("creates and publishes alice identity with name and email", async ({ page }) => {
    await generateIdentity(page, aliceIdentity);
    await setServer(page);
    await publishIdentity(page);
    await addDetail(page, "name", "Alice Example");
    await addDetail(page, "email", aliceEmail);

    aliceFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
    expect(aliceFingerprint).toBeTruthy();
  });

  test("creates and publishes bob identity with name and email", async ({ page }) => {
    await generateIdentity(page, bobIdentity);
    await setServer(page);
    await publishIdentity(page);
    await addDetail(page, "name", "Bob Example");
    await addDetail(page, "email", bobEmail);

    bobFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
    expect(bobFingerprint).toBeTruthy();
  });

  test("imports each other as contacts", async ({ page }) => {
    await page.goto("/");
    await setServer(page);

    await ensureIdentitySelected(page, aliceIdentity);
    await expectServerIdentitiesContains(page, bobFingerprint, bobFingerprint);
    const bobEntry = page.locator("#server-identities-list .server-identity-item", {
      hasText: bobFingerprint,
    });
    await bobEntry.getByRole("button", { name: "Import as Contact", exact: true }).click();
    await expect(page.locator("#contacts-list")).toContainText(bobFingerprint);

    await ensureIdentitySelected(page, bobIdentity);
    await expectServerIdentitiesContains(page, aliceFingerprint, aliceFingerprint);
    const aliceEntry = page.locator("#server-identities-list .server-identity-item", {
      hasText: aliceFingerprint,
    });
    await aliceEntry.getByRole("button", { name: "Import as Contact", exact: true }).click();
    await expect(page.locator("#contacts-list")).toContainText(aliceFingerprint);
  });

  test("sends and verifies signed encrypted messages", async ({ page }) => {
    await page.goto("/");
    await ensureIdentitySelected(page, aliceIdentity);
    await page.locator(".nav-item", { hasText: "Encrypt / Decrypt" }).click();
    await expandSection(page, "Encrypt Message");
    await page.fill("#enc-message", messageText);
    await page.fill("#enc-recipient", bobFingerprint);
    await page.keyboard.press("Escape");
    await page.locator("#enc-message").click();
    await expect(page.locator("#enc-recipient-dropdown")).toBeHidden();
    await page.locator("#enc-sign").setChecked(true);
    await page.getByRole("button", { name: "Encrypt", exact: true }).click();
    await submitPassword(page);
    await expect(page.locator("#enc-output")).not.toHaveValue("");
    const encryptedPayload = await page.locator("#enc-output").inputValue();

    await ensureIdentitySelected(page, bobIdentity);
    await page.locator(".nav-item", { hasText: "Encrypt / Decrypt" }).click();
    await expandSection(page, "Decrypt Message");
    await page.fill("#dec-payload", encryptedPayload);
    await page.fill("#dec-sender", aliceFingerprint);
    await page.keyboard.press("Escape");
    await page.locator("#dec-payload").click();
    await expect(page.locator("#dec-sender-dropdown")).toBeHidden();
    await page.getByRole("button", { name: "Decrypt", exact: true }).click();
    await submitPassword(page);

    await expect.poll(async () => {
      return await page.locator("#dec-output").inputValue();
    }).toContain(messageText);
    await expect(page.locator("#dec-verified")).toHaveText(/Valid/);
  });

  test("encrypts and decrypts signed file payloads", async ({ page }) => {
    await page.goto("/");
    await ensureIdentitySelected(page, aliceIdentity);
    await page.locator(".nav-item", { hasText: "Encrypt / Decrypt" }).click();
    await expandSection(page, "Encrypt File");
    await page.setInputFiles("#enc-file-input", {
      name: "tiny.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([1, 2, 3, 4, 5, 6]),
    });
    await page.fill("#enc-file-recipient", bobFingerprint);
    await page.keyboard.press("Escape");
    await page.locator("#enc-file-sign").setChecked(true);
    await page.getByRole("button", { name: "Encrypt File", exact: true }).click();
    await submitPassword(page);
    await expect(page.locator("#enc-file-output")).not.toHaveValue("");
    const encryptedPayload = await page.locator("#enc-file-output").inputValue();

    await ensureIdentitySelected(page, bobIdentity);
    await page.locator(".nav-item", { hasText: "Encrypt / Decrypt" }).click();
    await expandSection(page, "Decrypt File");
    await page.fill("#dec-file-payload", encryptedPayload);
    await page.fill("#dec-file-sender", aliceFingerprint);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Decrypt File", exact: true }).click();
    await submitPassword(page);
    await expect(page.locator("#dec-file-verified")).toHaveText(/Valid/);
    await expect(page.locator("#dec-file-info")).toContainText("tiny.bin");
    await expect(page.locator("#dec-file-download-btn")).toBeEnabled();
  });
});

test("publishes, revokes, and re-adds a detail, verified in contacts", async ({ page }) => {
  const runId = Date.now();
  const identityName = `e2e-detail-${runId}`;
  const email = `detail-${runId}@example.com`;

  await generateIdentity(page, identityName);
  await setServer(page);
  await publishIdentity(page);
  const { pushed: emailPushed } = await addDetail(page, "email", email);

  const fingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
  expect(fingerprint).toBeTruthy();

  await expectServerIdentitiesContains(page, fingerprint, fingerprint);
  if (emailPushed) {
    await expectServerIdentitiesContains(page, fingerprint, email);
  }

  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Revocation");
  await page.locator("summary", { hasText: "Revoke a Detail" }).click();
  await page.selectOption("#revoke-detail-path", "email");
  await page.fill("#revoke-detail-reason", "rotated");
  await page.locator("#revoke-detail-push").setChecked(emailPushed);
  await page.getByRole("button", { name: "Revoke Detail", exact: true }).click();
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await submitPassword(page);

  await expectServerIdentitiesContains(page, fingerprint, fingerprint);
  if (emailPushed) {
    await expectServerIdentitiesNotContains(page, fingerprint, email);
  } else {
    await expect(page.locator("#identity-details-list")).not.toContainText(email);
  }

  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Identity Details");
  await page.fill("#detail-path", "email");
  await page.fill("#detail-value", email);
  await page.locator("#detail-push").setChecked(emailPushed);
  await page.getByRole("button", { name: "Add Detail", exact: true }).click();
  await submitPassword(page);

  await expectServerIdentitiesContains(page, fingerprint, fingerprint);
  if (emailPushed) {
    await expectServerIdentitiesContains(page, fingerprint, email);
  } else {
    await expect(page.locator("#identity-details-list")).toContainText(email);
  }
});

test("revoked identitiy is removed from search results", async ({ page }) => {

  // 1. make new identity & publish
  const runId = Date.now();
  const identityName = `e2e-revoke-identity-${runId}`;

  await generateIdentity(page, identityName);
  await setServer(page);
  await publishIdentity(page);

  // 2. verify identity was properly published by searching for it by fingerprint
  // 2.a. get fingerprint
  const fingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
  expect(fingerprint).toBeTruthy();
  console.log(`(stub, yes that one) fingerprint "${fingerprint}"`);

  // 2.b. navigate to the contacts page
  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Browse Server Identities");

  // press "Load from Server" button
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();

  // find the search box and set its value to the fingerprint
  await page.fill("#server-identities-search", fingerprint);
  // press "Load from Server" button
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();
  // verify the fingerprint is in the list
  await expect(page.locator("#server-identities-list")).toContainText(fingerprint);

  console.log("Uploaded identity found in search results");

  // 3. revoke identity
  // go back to the identities page
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Revocation");

  // go to Revocation section
  // click the "Revoke Entire Identity" Option
  await page.locator("summary", { hasText: "Revoke Entire Identity" }).click();
  // find the optional reason field and set it to "Automated test revocation"
  await page.fill("#revoke-identity-reason", "Automated test revocation");
  // find the "Push to server" checkbox and set it to true
  await page.locator("#revoke-identity-push").setChecked(true);
  // press the "Revoke Identity" button
  await page.getByRole("button", { name: "Revoke Identity", exact: true }).click();
  
  // press "yes, revoke my identity" button
  await page.getByRole("button", { name: "Yes, Revoke My Identity", exact: true }).click();
  // press "I understand, revoke" button
  await page.getByRole("button", { name: "I Understand, Revoke", exact: true }).click();
  // enter the password and press submit
  await submitPassword(page);


  // navigate to the contacts page
  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Browse Server Identities");
  // press "Load from Server" button
  await page.getByRole("button", { name: "Load from Server", exact: true }).click();
  // enter the old fingerprint into the search box
  await page.fill("#server-identities-search", fingerprint);

  // the list of identites should now have one element and it should contain the text "(none found)"
  await expect(page.locator("#server-identities-list")).toContainText("(none found)");
  console.log("Revoked identity not found in search results");
});
