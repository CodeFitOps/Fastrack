/**
 * Local notifications for fast milestones.
 *
 * Key rule: notifications are SCHEDULED at an absolute future timestamp and
 * handed to the OS. They are never fired by a JS timer, because the app will not
 * be running when the fast completes — that is the whole point of the alert.
 *
 * Cancel-then-reschedule on every fast change, so a stopped fast never fires a
 * stale "you're done" alert hours later.
 */

import { platform } from './storage.js';
import { loadNative } from './native.js';
import { goalReachedAt } from '../core/fastSession.js';

const GOAL_NOTIFICATION_ID = 1001;

async function capacitorPlugin() {
  const mod = await loadNative('capacitorNotifications');
  return mod?.LocalNotifications ?? null;
}

/**
 * Ask for notification permission.
 *
 * Android 13+ (API 33) requires the POST_NOTIFICATIONS runtime permission and
 * will silently drop notifications without it — add it to AndroidManifest.xml
 * and request it here, not at install time.
 *
 * Call this from a user gesture (e.g. the "Start fast" tap), never on app load:
 * a cold-open permission prompt gets denied far more often, and on iOS a denial
 * is effectively permanent.
 *
 * @returns {Promise<boolean>} whether notifications are usable
 */
export async function requestPermission() {
  try {
    if (platform === 'capacitor') {
      const plugin = await capacitorPlugin();
      if (!plugin) return false;
      const { display } = await plugin.requestPermissions();
      return display === 'granted';
    }
    if (platform === 'tauri') {
      const m = await loadNative('tauriNotification');
      if (!m) return false;
      return (await m.isPermissionGranted()) || (await m.requestPermission()) === 'granted';
    }
    if (platform === 'web' && 'Notification' in window) {
      return (await Notification.requestPermission()) === 'granted';
    }
  } catch {
    // A notification failure must never block the fast itself.
  }
  return false;
}

/** Schedule the "goal reached" alert for a running fast. */
export async function scheduleGoalAlert(session) {
  await cancelGoalAlert();

  const fireAt = goalReachedAt(session);
  if (fireAt <= Date.now()) return; // goal already passed; nothing to schedule

  const title = 'Fast complete';
  const body = 'You reached your goal.';

  try {
    if (platform === 'capacitor') {
      const plugin = await capacitorPlugin();
      if (!plugin) return;
      await plugin.schedule({
        notifications: [{
          id: GOAL_NOTIFICATION_ID,
          title,
          body,
          schedule: { at: new Date(fireAt), allowWhileIdle: true },
        }],
      });
      return;
    }
    if (platform === 'tauri') {
      const mod = await loadNative('tauriNotification');
      if (!mod) return;
      const { sendNotification } = mod;
      // Tauri's notification plugin has no scheduling primitive. On desktop the
      // app is typically running, so a timer is acceptable as a fallback; on
      // Android, back this with a native alarm instead of shipping as-is.
      scheduleViaTimer(fireAt, () => sendNotification({ title, body }));
      return;
    }
    if (platform === 'web' && Notification?.permission === 'granted') {
      scheduleViaTimer(fireAt, () => new Notification(title, { body }));
    }
  } catch {
    // Non-fatal.
  }
}

export async function cancelGoalAlert() {
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  try {
    if (platform === 'capacitor') {
      const plugin = await capacitorPlugin();
      await plugin?.cancel({ notifications: [{ id: GOAL_NOTIFICATION_ID }] });
    }
  } catch {
    // Non-fatal.
  }
}

let fallbackTimer = null;

function scheduleViaTimer(fireAt, fn) {
  const delay = fireAt - Date.now();
  // setTimeout takes a signed 32-bit delay; anything longer fires immediately.
  if (delay <= 0 || delay > 2_147_483_647) return;
  fallbackTimer = setTimeout(fn, delay);
}
