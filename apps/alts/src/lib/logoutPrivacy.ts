import { clearClientSession, clearStoredToken } from "@ls/auth/authClient";
import { forgetDocusealKey } from "./docusealKey";
import { clearIntakeDraft } from "./intakeDraft";
import { clearSoCart } from "./soCart";

const NOTIFY_READY_PREFIX = "notify-ready-";

/** Remove customer-identifying browser state before the shared device changes hands. */
export function clearAltsPrivateStorage(): void {
  // Remove the Bearer fallback and cached profile before the network logout can block or fail.
  clearClientSession();
  clearStoredToken();
  clearIntakeDraft();
  clearSoCart();
  forgetDocusealKey();

  try {
    const notificationKeys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(NOTIFY_READY_PREFIX)) notificationKeys.push(key);
    }
    for (const key of notificationKeys) localStorage.removeItem(key);
  } catch {
    /* blocked storage must not prevent logout */
  }
}
