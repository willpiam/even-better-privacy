export async function discardResponseBody(response: Response): Promise<void> {
  const body =
    (response as unknown as { body?: { cancel?: () => Promise<void> } }).body;
  await body?.cancel?.();
}

/** Only authoritative absence consumes an HD discovery gap. */
export async function identityIsPublished(
  response: Response,
): Promise<boolean> {
  if (response.ok) {
    await discardResponseBody(response);
    return true;
  }
  if (response.status === 404) {
    await discardResponseBody(response);
    return false;
  }
  // Compatibility with older EBP servers, which used 400 for an unknown subject.
  if (response.status === 400) {
    const body = await response.json().catch(() => null);
    if (body?.error === "unknown subject") return false;
  } else await discardResponseBody(response);
  throw new Error(
    `Identity discovery incomplete: server returned HTTP ${response.status}`,
  );
}
