import { state } from "./state.js";
import { api, setStatus, setButtonLoading, escapeHtml } from "./ui.js";
import { showConfirmModal, requestPassword } from "./modals.js";

let _hierarchyTreeTooltip = null;

function _removeHierarchyTooltip() {
  if (_hierarchyTreeTooltip) {
    _hierarchyTreeTooltip.remove();
    _hierarchyTreeTooltip = null;
  }
}

function _showHierarchyTooltip(evt, html) {
  _removeHierarchyTooltip();
  const tip = document.createElement("div");
  tip.className = "ht-tooltip";
  tip.innerHTML = html;
  document.body.appendChild(tip);
  _hierarchyTreeTooltip = tip;

  const rect = tip.getBoundingClientRect();
  let x = evt.clientX + 14;
  let y = evt.clientY + 14;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - 8;
  if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - 8;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function _truncateDetailValue(val) {
  if (val.length <= 128) return val;
  return val.substring(0, 64) + "..." + val.substring(val.length - 64);
}

function _buildNodeTooltipHtml(node) {
  let html = `<div class="ht-tooltip-title">`;
  html += `<span class="ht-color-dot" style="background:${escapeHtml(node.color)}"></span>`;
  html += escapeHtml(node.label);
  if (node.isSelf) html += `<span class="ht-tooltip-badge self">YOU</span>`;
  if (node.isFocus) html += `<span class="ht-tooltip-badge focus">FOCUS</span>`;
  html += `</div>`;
  html += `<div class="ht-tooltip-fp">${escapeHtml(node.fingerprint)}</div>`;
  const entries = Object.entries(node.details || {});
  if (entries.length) {
    for (const [k, v] of entries) {
      html += `<div class="ht-tooltip-row"><span class="ht-tl">${escapeHtml(k)}:</span><span class="ht-tv">${escapeHtml(_truncateDetailValue(String(v)))}</span></div>`;
    }
  } else {
    html += `<div class="ht-tooltip-row"><span class="ht-tv muted">(no details)</span></div>`;
  }
  return html;
}

function _buildEdgeTooltipHtml(rel, nodeMap) {
  const masterLabel = nodeMap.get(rel.masterFingerprint)?.label || rel.masterFingerprint.substring(0, 16);
  const childLabel = nodeMap.get(rel.childFingerprint)?.label || rel.childFingerprint.substring(0, 16);
  let html = `<div class="ht-tooltip-title">Relationship`;
  if (rel.expired) html += `<span class="ht-tooltip-badge expired-badge">EXPIRED</span>`;
  html += `</div>`;
  html += `<div class="ht-tooltip-row"><span class="ht-tl">Master:</span><span class="ht-tv">${escapeHtml(masterLabel)}</span></div>`;
  html += `<div class="ht-tooltip-row"><span class="ht-tl">Child:</span><span class="ht-tv">${escapeHtml(childLabel)}</span></div>`;
  html += `<div class="ht-tooltip-row"><span class="ht-tl">Context:</span><span class="ht-tv">${escapeHtml(rel.context || "none")}</span></div>`;
  const ts = rel.timestamp ? new Date(rel.timestamp).toLocaleString() : "unknown";
  html += `<div class="ht-tooltip-row"><span class="ht-tl">Created:</span><span class="ht-tv">${escapeHtml(ts)}</span></div>`;
  const exp = rel.expiry && rel.expiry !== 0 ? new Date(rel.expiry).toLocaleString() : "never";
  html += `<div class="ht-tooltip-row"><span class="ht-tl">Expiry:</span><span class="ht-tv">${escapeHtml(exp)}</span></div>`;
  return html;
}

function _layoutTree(nodes, relationships, roots) {
  const childrenOf = new Map();
  const allFingerprints = new Set(nodes.map((n) => n.fingerprint));
  for (const fp of allFingerprints) childrenOf.set(fp, []);
  for (const rel of relationships) {
    const arr = childrenOf.get(rel.masterFingerprint) || [];
    if (!arr.includes(rel.childFingerprint)) arr.push(rel.childFingerprint);
    childrenOf.set(rel.masterFingerprint, arr);
  }

  const levels = new Map();
  const visited = new Set();

  const queue = [];
  for (const r of roots) {
    if (allFingerprints.has(r)) {
      queue.push({ fp: r, level: 0 });
      visited.add(r);
      levels.set(r, 0);
    }
  }

  for (const fp of allFingerprints) {
    if (!visited.has(fp)) {
      queue.push({ fp, level: 0 });
      visited.add(fp);
      levels.set(fp, 0);
    }
  }

  while (queue.length > 0) {
    const { fp, level } = queue.shift();
    const children = childrenOf.get(fp) || [];
    for (const child of children) {
      if (!levels.has(child)) {
        levels.set(child, level + 1);
        queue.push({ fp: child, level: level + 1 });
      }
    }
  }

  const byLevel = new Map();
  for (const [fp, lv] of levels) {
    const arr = byLevel.get(lv) || [];
    arr.push(fp);
    byLevel.set(lv, arr);
  }

  const maxLevel = Math.max(...Array.from(byLevel.keys()), 0);

  const nodeRadius = 26;
  const levelHeight = 160;
  const nodeSpacingX = 180;
  const paddingX = 100;
  const paddingY = 80;

  const positions = new Map();
  let maxRowWidth = 0;
  for (let lv = 0; lv <= maxLevel; lv++) {
    const row = byLevel.get(lv) || [];
    if (row.length > maxRowWidth) maxRowWidth = row.length;
  }
  const totalWidth = Math.max(maxRowWidth * nodeSpacingX, 200);

  for (let lv = 0; lv <= maxLevel; lv++) {
    const row = byLevel.get(lv) || [];
    const rowWidth = row.length * nodeSpacingX;
    const offsetX = (totalWidth - rowWidth) / 2 + nodeSpacingX / 2 + paddingX;
    const y = paddingY + lv * levelHeight;
    for (let i = 0; i < row.length; i++) {
      positions.set(row[i], { x: offsetX + i * nodeSpacingX, y });
    }
  }

  const svgWidth = totalWidth + paddingX * 2;
  const svgHeight = paddingY * 2 + maxLevel * levelHeight + nodeRadius;

  return { positions, svgWidth, svgHeight, nodeRadius };
}

export function renderHierarchyTreeSVG(container, data) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const relationships = Array.isArray(data?.relationships) ? data.relationships : [];
  const roots = Array.isArray(data?.roots) ? data.roots : [];

  if (!nodes.length) {
    container.innerHTML = '<div class="muted small" style="padding:16px">(no hierarchy relationships to display)</div>';
    return;
  }

  const nodeMap = new Map();
  for (const n of nodes) nodeMap.set(n.fingerprint, n);

  const { positions, svgWidth, svgHeight, nodeRadius } = _layoutTree(nodes, relationships, roots);

  const nodePos = new Map();
  for (const [fp, p] of positions) nodePos.set(fp, { x: p.x, y: p.y });

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  svg.style.userSelect = "none";

  let vb = { x: 0, y: 0, w: svgWidth, h: svgHeight };
  function applyViewBox() {
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function fitAllNodes() {
    if (!nodePos.size) return;
    const rect = container.getBoundingClientRect();
    const viewportW = Math.max(rect.width, 1);
    const viewportH = Math.max(rect.height, 1);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of nodePos.values()) {
      minX = Math.min(minX, p.x - nodeRadius - 12);
      maxX = Math.max(maxX, p.x + nodeRadius + 12);
      minY = Math.min(minY, p.y - nodeRadius - 12);
      maxY = Math.max(maxY, p.y + nodeRadius + 36);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return;

    const pad = 32;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;

    let contentW = Math.max(maxX - minX, 1);
    let contentH = Math.max(maxY - minY, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const viewportAspect = viewportW / viewportH;
    const contentAspect = contentW / contentH;

    if (contentAspect > viewportAspect) {
      contentH = contentW / viewportAspect;
    } else {
      contentW = contentH * viewportAspect;
    }

    vb = { x: centerX - contentW / 2, y: centerY - contentH / 2, w: contentW, h: contentH };
    applyViewBox();
  }

  function clientToSVG(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  const arrowGap = 4;
  function edgePathD(masterFp, childFp) {
    const from = nodePos.get(masterFp);
    const to = nodePos.get(childFp);
    if (!from || !to) return "";
    const startY = from.y + nodeRadius;
    const endY = to.y - nodeRadius - arrowGap;
    const midY = (startY + endY) / 2;
    return `M ${from.x} ${startY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${endY}`;
  }

  const edgeElements = [];

  const defs = document.createElementNS(ns, "defs");
  svg.appendChild(defs);

  for (const rel of relationships) {
    const pathD = edgePathD(rel.masterFingerprint, rel.childFingerprint);
    if (!pathD) continue;
    const edgeColor = rel.expired ? "var(--warning)" : "var(--text-muted)";

    const arrowId = `arrow-${rel.masterFingerprint.substring(0, 8)}-${rel.childFingerprint.substring(0, 8)}`;
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", arrowId);
    marker.setAttribute("markerWidth", "12");
    marker.setAttribute("markerHeight", "10");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "5");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    const ap = document.createElementNS(ns, "path");
    ap.setAttribute("d", "M 0 0 L 12 5 L 0 10 L 3 5 Z");
    ap.setAttribute("fill", edgeColor);
    marker.appendChild(ap);
    defs.appendChild(marker);

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", pathD);
    path.setAttribute("class", `ht-edge${rel.expired ? " expired" : ""}`);
    path.setAttribute("stroke", edgeColor);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("marker-end", `url(#${arrowId})`);

    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("d", pathD);
    hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "16");
    hitPath.setAttribute("fill", "none");
    hitPath.style.cursor = "pointer";

    hitPath.addEventListener("mouseenter", (e) => _showHierarchyTooltip(e, _buildEdgeTooltipHtml(rel, nodeMap)));
    hitPath.addEventListener("mousemove", (e) => {
      if (_hierarchyTreeTooltip) {
        let x = e.clientX + 14, y = e.clientY + 14;
        const r = _hierarchyTreeTooltip.getBoundingClientRect();
        if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 8;
        if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 8;
        _hierarchyTreeTooltip.style.left = x + "px";
        _hierarchyTreeTooltip.style.top = y + "px";
      }
    });
    hitPath.addEventListener("mouseleave", _removeHierarchyTooltip);

    svg.appendChild(path);
    svg.appendChild(hitPath);
    edgeElements.push({ rel, path, hitPath });
  }

  function refreshEdges(fp) {
    for (const e of edgeElements) {
      if (e.rel.masterFingerprint === fp || e.rel.childFingerprint === fp) {
        const d = edgePathD(e.rel.masterFingerprint, e.rel.childFingerprint);
        e.path.setAttribute("d", d);
        e.hitPath.setAttribute("d", d);
      }
    }
  }

  let dragState = null;

  for (const node of nodes) {
    const pos = nodePos.get(node.fingerprint);
    if (!pos) continue;

    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "ht-node-group");
    g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);

    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", 0);
    circle.setAttribute("cy", 0);
    circle.setAttribute("r", nodeRadius);
    circle.setAttribute("fill", node.color);
    const circleClasses = ["ht-node-circle"];
    if (node.isSelf) circleClasses.push("ht-self");
    if (node.isFocus) circleClasses.push("ht-focus");
    circle.setAttribute("class", circleClasses.join(" "));
    g.appendChild(circle);

    const labelText = document.createElementNS(ns, "text");
    labelText.setAttribute("x", 0);
    labelText.setAttribute("y", nodeRadius + 16);
    labelText.setAttribute("class", "ht-label");
    const truncLabel = node.label.length > 14 ? node.label.substring(0, 13) + "…" : node.label;
    labelText.textContent = truncLabel;
    g.appendChild(labelText);

    const fpText = document.createElementNS(ns, "text");
    fpText.setAttribute("x", 0);
    fpText.setAttribute("y", nodeRadius + 28);
    fpText.setAttribute("class", "ht-fp-label");
    fpText.textContent = node.fingerprint.substring(0, 16) + "…";
    g.appendChild(fpText);

    g.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      _removeHierarchyTooltip();
      const svgPt = clientToSVG(e.clientX, e.clientY);
      const p = nodePos.get(node.fingerprint);
      dragState = { fp: node.fingerprint, g, node, offsetX: svgPt.x - p.x, offsetY: svgPt.y - p.y };
      g.classList.add("dragging");
      svg.appendChild(g);
    });

    g.addEventListener("mouseenter", (e) => {
      if (!dragState) _showHierarchyTooltip(e, _buildNodeTooltipHtml(node));
    });
    g.addEventListener("mouseleave", () => {
      if (!dragState) _removeHierarchyTooltip();
    });

    svg.appendChild(g);
  }

  svg.addEventListener("mousemove", (e) => {
    if (dragState) {
      const svgPt = clientToSVG(e.clientX, e.clientY);
      const nx = svgPt.x - dragState.offsetX;
      const ny = svgPt.y - dragState.offsetY;
      nodePos.set(dragState.fp, { x: nx, y: ny });
      dragState.g.setAttribute("transform", `translate(${nx}, ${ny})`);
      refreshEdges(dragState.fp);
    }
  });

  svg.addEventListener("mouseup", () => {
    if (dragState) { dragState.g.classList.remove("dragging"); dragState = null; }
  });

  svg.addEventListener("mouseleave", () => {
    if (dragState) { dragState.g.classList.remove("dragging"); dragState = null; }
  });

  let panState = null;
  svg.addEventListener("mousedown", (e) => {
    if (dragState) return;
    if (e.button !== 0) return;
    panState = { startX: e.clientX, startY: e.clientY, startVbX: vb.x, startVbY: vb.y };
    svg.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (e) => {
    if (!panState) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = vb.w / rect.width;
    const scaleY = vb.h / rect.height;
    vb.x = panState.startVbX - (e.clientX - panState.startX) * scaleX;
    vb.y = panState.startVbY - (e.clientY - panState.startY) * scaleY;
    applyViewBox();
  });

  window.addEventListener("mouseup", () => {
    if (panState) { panState = null; svg.style.cursor = ""; }
  });

  container.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x;
    const mouseY = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y;
    const newW = vb.w * zoomFactor;
    const newH = vb.h * zoomFactor;
    vb.x = mouseX - (mouseX - vb.x) * (newW / vb.w);
    vb.y = mouseY - (mouseY - vb.y) * (newH / vb.h);
    vb.w = newW;
    vb.h = newH;
    applyViewBox();
  }, { passive: false });

  container.innerHTML = "";
  container.appendChild(svg);

  const fitAllBtn = document.createElement("button");
  fitAllBtn.type = "button";
  fitAllBtn.className = "secondary";
  fitAllBtn.textContent = "fit all";
  fitAllBtn.style.position = "absolute";
  fitAllBtn.style.top = "10px";
  fitAllBtn.style.right = "10px";
  fitAllBtn.style.zIndex = "5";
  fitAllBtn.style.padding = "4px 10px";
  fitAllBtn.style.fontSize = "0.78rem";
  fitAllBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  fitAllBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fitAllNodes();
  });
  container.appendChild(fitAllBtn);
}

export async function loadHierarchyTree() {
  const container = document.getElementById("hierarchy-tree-container");
  if (!container) return;
  container.innerHTML = '<div class="muted small" style="padding:16px">Loading hierarchy tree…</div>';

  try {
    const data = await api("/hierarchy/tree");
    renderHierarchyTreeSVG(container, data);
  } catch (err) {
    container.innerHTML = `<div class="muted small" style="padding:16px">Failed to load hierarchy tree: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

export function resolveCertificateFingerprint(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("ebp")) return raw;
  const byName = state.contacts.find((c) => (c.name || "").toLowerCase() === raw.toLowerCase());
  if (byName?.fingerprint) return byName.fingerprint;
  const prefixMatches = state.contacts.filter((c) => (c.fingerprint || "").startsWith(raw));
  if (prefixMatches.length === 1) return prefixMatches[0].fingerprint;
  return raw;
}

function certificateRelationshipLabel(rel, currentFingerprint) {
  if (rel.masterFingerprint === currentFingerprint) {
    return `You are master of ${rel.childFingerprint}`;
  }
  if (rel.childFingerprint === currentFingerprint) {
    return `You are child of ${rel.masterFingerprint}`;
  }
  return `${rel.masterFingerprint} -> ${rel.childFingerprint}`;
}

export function renderCertificatesActiveList(relationships) {
  const list = document.getElementById("certificates-active-list");
  if (!list) return;
  if (!relationships.length) {
    list.innerHTML = "<li class='muted'>(no active hierarchy certificates)</li>";
    return;
  }
  list.innerHTML = "";
  for (const rel of relationships) {
    const li = document.createElement("li");
    li.classList.add("certificate-clickable");
    const expires = rel.expiry && rel.expiry !== 0 ? new Date(rel.expiry).toLocaleString() : "never";
    li.innerHTML = `
      <div><strong>${escapeHtml(certificateRelationshipLabel(rel, state.currentFingerprint || ""))}</strong></div>
      <div class="muted">context: ${escapeHtml(rel.context || "none")} · expiry: ${escapeHtml(String(expires))}${rel.expired ? " · EXPIRED" : ""}</div>
    `;
    li.addEventListener("click", () => showCertificateDetails(rel));
    list.appendChild(li);
  }
}

export function showCertificateDetails(rel) {
  document.getElementById("cert-detail-master").textContent = rel.masterFingerprint;
  document.getElementById("cert-detail-child").textContent = rel.childFingerprint;
  document.getElementById("cert-detail-context").textContent = rel.context || "none";
  document.getElementById("cert-detail-timestamp").textContent = rel.timestamp
    ? new Date(rel.timestamp).toLocaleString()
    : "unknown";
  const expiryText = rel.expiry && rel.expiry !== 0 ? new Date(rel.expiry).toLocaleString() : "never";
  document.getElementById("cert-detail-expiry").textContent = expiryText;

  const expiredField = document.getElementById("cert-detail-expired-field");
  expiredField.style.display = rel.expired ? "flex" : "none";

  const rawEl = document.getElementById("cert-detail-raw");
  if (rel.certificate) {
    try {
      const decoded = JSON.parse(
        rel.certificate.match(/.{1,2}/g).map(b => String.fromCharCode(parseInt(b, 16))).join("")
      );
      rawEl.textContent = JSON.stringify(decoded, null, 2);
    } catch {
      rawEl.textContent = rel.certificate;
    }
  } else {
    rawEl.textContent = "(certificate data not available)";
  }

  document.getElementById("certificate-detail-modal").classList.add("active");
}

export function renderCertificatesPendingList(proposals) {
  const list = document.getElementById("certificates-pending-list");
  if (!list) return;
  if (!proposals.length) {
    list.innerHTML = "<li class='muted'>(no pending certificates)</li>";
    return;
  }
  list.innerHTML = "";
  for (const proposal of proposals) {
    const li = document.createElement("li");
    const created = proposal.createdAt ? new Date(proposal.createdAt).toLocaleString() : "unknown";
    const expires = proposal.expiry && proposal.expiry !== 0 ? new Date(proposal.expiry).toLocaleString() : "never";
    li.innerHTML = `
      <div><strong>${escapeHtml(proposal.masterFingerprint)} -> ${escapeHtml(proposal.childFingerprint)}</strong></div>
      <div class="muted">proposed by: ${escapeHtml(proposal.proposerFingerprint)} · context: ${escapeHtml(proposal.context || "none")} · created: ${escapeHtml(created)} · expiry: ${escapeHtml(String(expires))}</div>
      <div class="row" style="margin-top: 8px;">
        <button type="button" class="secondary certificate-accept-btn">Accept</button>
        <button type="button" class="danger certificate-reject-btn">Reject</button>
      </div>
    `;
    li.querySelector(".certificate-accept-btn").addEventListener("click", async () => {
      await handleAcceptProposal(proposal.id, proposal.certificate);
    });
    li.querySelector(".certificate-reject-btn").addEventListener("click", async () => {
      await handleRejectProposal(proposal.id);
    });
    list.appendChild(li);
  }
}

export async function renderCertificatesPage() {
  try {
    const activePromise = api("/hierarchy/list");
    const pendingPromise = state.server ? api("/hierarchy/pending") : Promise.resolve({ proposals: [] });
    const [activeRes, pendingRes] = await Promise.all([activePromise, pendingPromise]);
    const active = Array.isArray(activeRes?.relationships) ? activeRes.relationships : [];
    const pending = Array.isArray(pendingRes?.proposals) ? pendingRes.proposals : [];
    state.hierarchyRelationships = active;
    renderCertificatesActiveList(active);
    renderCertificatesPendingList(pending);
    if (!state.server) {
      const pendingList = document.getElementById("certificates-pending-list");
      if (pendingList) {
        pendingList.innerHTML = "<li class='muted'>(configure a server to receive pending proposals)</li>";
      }
    }
  } catch (err) {
    const activeList = document.getElementById("certificates-active-list");
    const pendingList = document.getElementById("certificates-pending-list");
    const msg = escapeHtml(err.message || String(err));
    if (activeList) activeList.innerHTML = `<li class="muted">failed to load certificates: ${msg}</li>`;
    if (pendingList) pendingList.innerHTML = `<li class="muted">failed to load certificates: ${msg}</li>`;
  }
}

export function navigateToHierarchyWithContact(fingerprint, navigateTo) {
  navigateTo("certificates");
  const sectionToggle = Array.from(document.querySelectorAll(".page.active section > .section-toggle")).find((toggle) =>
    toggle.textContent.includes("Propose Hierarchy")
  );
  if (sectionToggle && sectionToggle.getAttribute("aria-expanded") !== "true") {
    sectionToggle.click();
  }
  const input = document.getElementById("certificate-other-fingerprint");
  if (input) {
    input.value = fingerprint;
    input.focus();
  }
}

export async function handleAcceptProposal(proposalId, certificate) {
  try {
    const password = await requestPassword("Enter password to accept and sign this certificate");
    if (!password) {
      setStatus("Password is required", "error");
      return;
    }
    await api("/hierarchy/accept", {
      method: "POST",
      body: JSON.stringify({ proposalId, certificate, password }),
    });
    setStatus("Certificate accepted and signed", "success");
    await renderCertificatesPage();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

export async function handleRejectProposal(proposalId) {
  const confirmed = await showConfirmModal(
    "Reject Certificate Proposal",
    "Reject this pending certificate proposal? This will remove it from the server.",
    "Reject",
  );
  if (!confirmed) return;
  try {
    await api("/hierarchy/reject", {
      method: "POST",
      body: JSON.stringify({ proposalId }),
    });
    setStatus("Certificate proposal rejected", "success");
    await renderCertificatesPage();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

export async function loadContactHierarchyDiagram(fingerprint) {
  const container = document.getElementById("contact-detail-hierarchy");
  container.innerHTML = '<div class="muted small" style="padding:16px">Loading hierarchy…</div>';
  const data = await api(`/hierarchy/${encodeURIComponent(fingerprint)}`);
  renderHierarchyTreeSVG(container, data);
}
