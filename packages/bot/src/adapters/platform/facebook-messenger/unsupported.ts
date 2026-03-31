/**
 * Facebook Messenger — Unsupported Operation Stubs
 *
 * All operations that cannot be performed on Facebook Messenger are grouped here
 * to reduce file clutter and provide a single location for unsupported method documentation.
 *
 * Facebook Messenger (fca-unofficial) limitations:
 *   - removeGroupImage: fca-unofficial exposes api.changeGroupImage() to SET a new image,
 *                       but has no endpoint to REMOVE or RESET the group image back to the default.
 *                       The underlying Facebook Graph API similarly has no "delete group photo"
 *                       operation via MQTT.
 *
 * Command modules that call these should catch the thrown error and surface a
 * user-friendly message rather than letting the rejection bubble to the handler.
 */

/**
 * Unsupported: fca-unofficial has no group image removal endpoint.
 * Returns Promise<never> — always rejects by design; callers must handle the rejection.
 */
export function removeGroupImage(): Promise<never> {
  return Promise.reject(
    new Error(
      'removeGroupImage is not supported on Facebook Messenger — ' +
        'fca-unofficial exposes no group image removal endpoint',
    ),
  );
}
