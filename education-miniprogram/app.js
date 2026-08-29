App({
  onError(error) {
    console.error('[education-shell] application error', error);
  },

  onUnhandledRejection(event) {
    console.error('[education-shell] unhandled rejection', event.reason);
  },
});
