import { expect, test, type Page } from "@playwright/test";

const testPassword = "Smoke-test-password1";
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

async function generateIdentity(page: Page, identityName: string, password = testPassword) {
  await page.goto("/");
  await expandSection(page, "Create New Identity");
  await page.fill("#gen-name", identityName);
  await page.getByRole("button", { name: "Generate Identity", exact: true }).click();
  await submitPassword(page, password);
  await expect(page.locator("#identity-list")).toContainText(identityName);
}

async function publishIdentity(page: Page, serverUrl = testServerUrl, password = testPassword) {
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Publish to Server");
  await page.fill("#publish-server", serverUrl);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await submitPassword(page, password);
}

async function ensureIdentitySelected(page: Page, identityName: string) {
  const currentIdentity = (await page.locator("#ctx-current").textContent())?.trim();
  if (currentIdentity === identityName) {
    return;
  }
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Your Identities");
  await page.locator("#identity-list li", { hasText: identityName }).click();
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator("#ctx-current")).toHaveText(identityName);
}

async function openHierarchyCreateForm(page: Page) {
  await page.locator(".nav-item", { hasText: "Certificates" }).click();
  await expandSection(page, "Propose Hierarchy");
  const createForm = page.locator("#certificate-propose-form");
  if (!(await createForm.isVisible())) {
    await page.locator("summary", { hasText: "Propose Hierarchy" }).click();
  }
  await expect(createForm).toBeVisible();
}

async function createAndSignHierarchyViaGui(page: Page, input: {
  role: "master" | "child";
  otherFingerprint: string;
  context?: string;
}) {
  await openHierarchyCreateForm(page);
  if (input.role === "master") {
    await page.locator("#certificate-role-master").setChecked(true);
  } else {
    await page.locator("#certificate-role-child").setChecked(true);
  }
  await page.fill("#certificate-other-fingerprint", input.otherFingerprint);
  await page.fill("#certificate-context", input.context ?? "e2e hierarchy");
  await page.getByRole("button", { name: "Propose Certificate", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#status")).toContainText(/proposed|awaiting/i);
}

test("establishes a hierarchy and renders it in the contact hierarchy tree", async ({
  page,
}) => {
  const runId = Date.now();
  const masterIdentity = `e2e-h-master-${runId}`;
  const childIdentity = `e2e-h-child-${runId}`;

  await generateIdentity(page, masterIdentity);
  await setServer(page, testServerUrl);
  await publishIdentity(page);
  const masterFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
  expect(masterFingerprint).toBeTruthy();

  await generateIdentity(page, childIdentity);
  await setServer(page, testServerUrl);
  await publishIdentity(page);
  const childFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
  expect(childFingerprint).toBeTruthy();

  await ensureIdentitySelected(page, masterIdentity);
  await createAndSignHierarchyViaGui(page, {
    role: "master",
    otherFingerprint: childFingerprint,
    context: "e2e hierarchy",
  });

  await ensureIdentitySelected(page, childIdentity);
  await page.locator(".nav-item", { hasText: "Certificates" }).click();
  await expandSection(page, "Pending Proposals");
  const pendingItem = page.locator("#certificates-pending-list li", {
    hasText: masterFingerprint,
  }).first();
  await expect(pendingItem).toContainText(childFingerprint);
  await pendingItem.getByRole("button", { name: "Accept", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#status")).toContainText(/accepted|signed/i);

  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Fetch from Server");
  await page.fill("#fetch-fp", masterFingerprint);
  await page.fill("#fetch-name", "master-contact");
  await page.fill("#fetch-server", testServerUrl);
  await page.getByRole("button", { name: "Fetch", exact: true }).click();
  await expandSection(page, "Known Contacts");
  await expect(page.locator("#contacts-list")).toContainText(masterFingerprint.slice(0, 16));
  await page.locator("#contacts-list .contact-item", { hasText: "master-contact" }).first().click();

  await page.getByRole("button", { name: "View Hierarchy", exact: true }).click();
  await expect(page.locator("#contact-detail-hierarchy svg")).toBeVisible();
  await expect(page.locator("#contact-detail-hierarchy .ht-node-group")).toHaveCount(2);
  await expect(page.locator("#contact-detail-hierarchy button", { hasText: "fit all" })).toBeVisible();
});

test("rejects a loop when attempting reverse hierarchy relationship", async ({ page }) => {
  const runId = Date.now();
  const masterIdentity = `e2e-h-loop-master-${runId}`;
  const childIdentity = `e2e-h-loop-child-${runId}`;

  await generateIdentity(page, masterIdentity);
  await setServer(page, testServerUrl);
  await publishIdentity(page);
  const masterFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";

  await generateIdentity(page, childIdentity);
  await setServer(page, testServerUrl);
  await publishIdentity(page);
  const childFingerprint = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";

  await ensureIdentitySelected(page, masterIdentity);
  await createAndSignHierarchyViaGui(page, {
    role: "master",
    otherFingerprint: childFingerprint,
    context: "forward",
  });
  await ensureIdentitySelected(page, childIdentity);
  await page.locator(".nav-item", { hasText: "Certificates" }).click();
  await expandSection(page, "Pending Proposals");
  const firstPending = page.locator("#certificates-pending-list li", { hasText: masterFingerprint }).first();
  await firstPending.getByRole("button", { name: "Accept", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#status")).toContainText(/accepted|signed/i);

  // Reverse edge is rejected at propose time (server/core loop detection),
  // not left as a pending proposal for the other party to reject.
  await openHierarchyCreateForm(page);
  await page.locator("#certificate-role-master").setChecked(true);
  await page.fill("#certificate-other-fingerprint", masterFingerprint);
  await page.fill("#certificate-context", "reverse");
  await page.getByRole("button", { name: "Propose Certificate", exact: true }).click();
  await submitPassword(page);
  await expect(page.locator("#status")).toContainText(/hierarchy loop detected/i);
});
