// Public settings for the careers page. Nothing secret belongs here: the AI key and the
// backend's intake token live on the server (see frontend/.env.example).

export const config = {
  intake: {
    // Which chat opens first: 'guided' (Path C), 'ai' (Path B) or 'typeform' (Path A).
    // You can also deep-link with ?intake=ai, ?intake=guided or ?intake=typeform.
    defaultMode: 'guided',
    // Show the "How would you like to apply?" switch inside the chat window.
    showModeSwitch: true,
  },
  typeform: {
    // The ID at the end of your form's share link: form.typeform.com/to/AbCd1234 -> 'AbCd1234'.
    // Leave empty to hide the Typeform option.
    formId: '',
    // true = Typeform test mode: nothing is recorded, so testing doesn't use up the
    // free plan's 10 responses a month. Set to false when you go live.
    sandbox: true,
  },
};
