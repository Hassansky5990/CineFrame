# CineFrame email setup

These are branded Supabase Auth email templates. The HTML files are source templates for copying into the Supabase Dashboard; adding them to GitHub does not publish them to Supabase automatically.

## Apply the templates

1. Open Supabase Dashboard → Authentication → Email Templates.
2. Open **Confirm signup**. Set the subject to: `Confirm your CineFrame account`. Replace the message body with `confirmation.html`.
3. Open **Reset password**. Set the subject to: `Reset your CineFrame password`. Replace the message body with `recovery.html`.
4. Save each template and send a test email.

Both templates use Supabase's `{{ .ConfirmationURL }}` variable. Keep it unchanged; it carries the secure confirmation/recovery link.

## Fix email rate limits

Supabase's built-in email service is intentionally limited and is not intended for production delivery. Configure a trusted SMTP provider in **Authentication → SMTP Settings** (for example, Resend, Postmark, or Amazon SES), verify a sending domain you control, and use that provider's SMTP host, port, username, and password. Then review **Authentication → Rate Limits** and adjust limits only as appropriate for your verified SMTP setup.

Do not put SMTP credentials, service-role keys, or secret API keys in `index.html`, GitHub client-side code, or public environment variables. Store SMTP credentials only in Supabase's protected SMTP settings.

The app now prevents repeated reset-email requests from the same browser for 60 seconds and shows a clearer message when Supabase rejects delivery. This client-side cooldown improves UX; it does not increase Supabase's server-side email quota.
