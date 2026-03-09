# Email / Password Reset Setup

## SMTP Configuration (`.env`)

### Gmail (recommended for testing)

1. Enable 2-Factor Authentication at https://myaccount.google.com/security
2. Generate App Password at https://myaccount.google.com/apppasswords
3. Configure:

```bash
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
EMAIL_FROM=your-email@gmail.com
FRONTEND_URL=http://localhost:50101
```

### Other providers

| Provider | HOST | PORT |
|----------|------|------|
| Mailtrap | `smtp.mailtrap.io` | `2525` |
| SendGrid | `smtp.sendgrid.net` | `587` |
| Outlook | `smtp-mail.outlook.com` | `587` |

## Testing the flow

```bash
# 1. Request reset
curl -X POST http://localhost:50100/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# 2. Copy token from email (or server console if SMTP not configured)

# 3. Set new password
curl -X POST http://localhost:50100/api/v1/auth/reset-password/confirm \
  -H "Content-Type: application/json" \
  -d '{"token": "...", "newPassword": "NewPassword123"}'
```

## Without SMTP

If email is not configured, the reset token is printed to the server console. Look for:
```
Email transport not configured. Reset token: eyJhbG...
```
