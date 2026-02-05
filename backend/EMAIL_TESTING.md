# Email Password Reset Testing

## Setup

### 1. Gmail Configuration (Recommended for Testing)

1. **Enable 2-Factor Authentication**
   - Go to https://myaccount.google.com/security
   - Enable "2-Step Verification"

2. **Generate App Password**
   - Go to https://myaccount.google.com/apppasswords
   - Create new App Password for "Mail"
   - Copy generated password (16 characters)

3. **Configure .env**
   ```bash
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_SECURE=false
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASSWORD=your-16-char-app-password
   EMAIL_FROM=your-email@gmail.com
   FRONTEND_URL=http://localhost:5173
   ```

### 2. Alternative SMTP Servers

#### Mailtrap (for development)
```bash
EMAIL_HOST=smtp.mailtrap.io
EMAIL_PORT=2525
EMAIL_USER=your-mailtrap-username
EMAIL_PASSWORD=your-mailtrap-password
```

#### SendGrid
```bash
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASSWORD=your-sendgrid-api-key
```

#### Outlook/Hotmail
```bash
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@outlook.com
EMAIL_PASSWORD=your-password
```

## API Testing

### 1. Register User (if not already)

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 2. Request Password Reset

```bash
curl -X POST http://localhost:3000/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com"
  }'
```

**Expected response:**
```json
{
  "message": "If the email exists in the system, password reset instructions have been sent"
}
```

**What happens:**
- Backend generates JWT token with 1h expiration
- Sends email with reset link
- Email contains link like: `http://localhost:5173/reset-password?token=eyJhbG...`

### 3. Check Email

Open email and copy token from URL (part after `?token=`)

### 4. Confirm New Password

```bash
curl -X POST http://localhost:3000/api/v1/auth/reset-password/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "newPassword": "NewSecurePassword123"
  }'
```

**Expected response:**
```json
{
  "message": "Password changed successfully. You can now login with your new password."
}
```

### 5. Verify New Password

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "NewSecurePassword123"
  }'
```

## Testing Without Email Configuration

If SMTP server is not configured, backend will still work, but:
- Reset token is printed to server console
- Email is not sent
- You can manually copy token from console for testing

**Look for in console:**
```
Reset email sent: <messageId>
```
or
```
Email transport not configured. Reset token: eyJhbG...
```

## Common Errors and Solutions

### "Email transport not configured"
- Check EMAIL_USER and EMAIL_PASSWORD in .env
- Restart server after changing .env

### "Invalid login: 535 Authentication failed"
- For Gmail: use App Password instead of regular password
- Check that 2FA is enabled

### "Token expired"
- Token is valid for 1 hour
- Request new password reset

### Email not arriving
- Check spam folder
- Verify EMAIL_FROM address
- Try different SMTP server (e.g., Mailtrap for testing)

## Frontend Implementation

Create `/reset-password` page in frontend:

```javascript
// ResetPassword.jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch('http://localhost:3000/api/v1/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });
      
      const data = await response.json();
      setMessage(data.message || data.error);
      
      if (response.ok) {
        // Redirect to login after 2 seconds
        setTimeout(() => {
          window.location.href = '/login';
        }, 2000);
      }
    } catch (error) {
      setMessage('Error resetting password');
    }
  };

  return (
    <div>
      <h1>Reset Password</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength="8"
        />
        <button type="submit">Change Password</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}
```

## Monitoring

For production consider:
- Logging all reset attempts
- Rate limiting for reset endpoints
- Email delivery monitoring
- Alerting on SMTP failures
