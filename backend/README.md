
# Backend for Measure (analytics) project

Measure is a general analytics tool focused on workflow-based analyses and script execution.

## Backend API

REST API for managing analyses, workflows, scripts, and results with JWT authentication.

## Features

- 🔐 JWT Authentication
- 📊 Analysis with Workflow Scripts
- 🔒 Atomic Workflow Execution (queue for concurrent analyses)
- 📁 ZIP Export of Results
- 🔄 Workflow Templates
- 🔒 Security Middleware (helmet, cors, rate limiting)

## Technologies

- **Backend**: Node.js, Express, MySQL
- **Authentication**: JWT, bcrypt
- **Security**: Helmet, CORS, Rate limiting
- **Database**: MySQL/MariaDB
- **Python**: Analysis scripts (optional)

## Installation

### Quick Setup (Recommended)

```bash
# Clone repository
git clone <repository-url>
cd measure-backend

# Run automated setup
./setup.sh

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Setup database (see below)
```

### Manual Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd measure-backend
```

### 2. Install Node.js Dependencies
```bash
npm install
```

### 3. Setup Python Environment
```bash
cd scripts/analyzy
./setup-python-env.sh
cd ../..
```

See [PYTHON_SETUP.md](PYTHON_SETUP.md) for detailed Python setup instructions.

### 4. Setup Reporter Dependencies
```bash
cd scripts/reports
npm install
cd ../..
```

Reporter uses its own `package.json` for generating Word documents. More info in [scripts/reports/REPORTER.md](scripts/reports/REPORTER.md).

### 5. Configure Environment
```bash
# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### 6. Setup Database
Create tables for `usr`, `analysis`, and `result` (see DB schema below).

### 7. Start Server
```bash
npm start
```

## ⚙️ Configuration

The application uses `config.json` for settings:

```json
{
  "paths": {
    "scripts": "scripts",
    "results": "results"
  },
  "scriptCommands": {
    ".py": {
      "command": "python3",
      "description": "Python scripts"
    },
    ".js": {
      "command": "node", 
      "description": "Node.js scripts"
    },
    ".r": {
      "command": "Rscript",
      "description": "R scripts"
    }
  },
  "logging": {
    "logFileName": "analysis.log",
    "errorFileName": "analysis.err",
    "separatorChar": "=",
    "separatorLength": 80
  }
}
```

### Adding New Script Types

To add support for a new language (e.g., Julia):

```json
{
  "scriptCommands": {
    ".jl": {
      "command": "julia",
      "description": "Julia scripts"
    }
  }
}
```

### Email Configuration for Password Reset

Configure email settings in `.env`:

```bash
# Gmail example
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
EMAIL_FROM=noreply@measure-backend.com
FRONTEND_URL=http://localhost:5173
```

**For Gmail:**
1. Enable 2-Factor Authentication
2. Generate App-Specific Password at: https://myaccount.google.com/apppasswords
3. Use the generated password as `EMAIL_PASSWORD`

**For other SMTP providers:**
- Update `EMAIL_HOST` and `EMAIL_PORT` accordingly
- Set `EMAIL_SECURE=true` for SSL/TLS (usually port 465)
- Set `EMAIL_SECURE=false` for STARTTLS (usually port 587)

## Environment Variables

```bash
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=measure_db
JWT_SECRET=your-super-secret-jwt-key
CORS_ORIGINS=http://localhost:3000
```

## API Endpoints

### 🔐 Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/register` - User registration  
- `GET /api/v1/auth/me` - Get current user info
- `POST /api/v1/auth/reset-password` - Password reset

### 📊 Analyses
- `GET /api/v1/analyses` - List analyses
- `POST /api/v1/analyses` - Create analysis
- `GET /api/v1/analyses/:id` - Get analysis details
- `PUT /api/v1/analyses/:id` - Update analysis
- `DELETE /api/v1/analyses/:id` - Delete analysis
- `POST /api/v1/analyses/:id/run` - Run analysis

### 📁 Results
- `GET /api/v1/results` - List analysis results
  - Query params: `analysis_id`
- `GET /api/v1/results/:id` - Get result details
- `GET /api/v1/results/:id/download` - Download ZIP with results

### 🔄 Workflows
- `GET /api/v1/workflows` - List available workflows
- `GET /api/v1/workflows/:name` - Get workflow content

### 🧮 SQL
- `POST /api/v1/sql` - Run read-only SQL query
- `GET /api/v1/sql/datasources` - List available datasources

### 🔧 System
- `GET /api/health` - Health check

## Project Structure

```
├── src/
│   ├── routes/          # API routes
│   ├── middleware/      # Express middleware
│   ├── config.js        # Configuration
│   ├── db.js           # Database connection
│   └── index.js        # Main server file
├── scripts/            # Analysis scripts and workflows
├── results/            # Analysis results (gitignored)
├── common/             # Common resources (gitignored)
└── package.json
```

## Database Schema

### Core Tables

```sql
-- Users
CREATE TABLE usr (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analyses
CREATE TABLE analysis (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  settings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analysis Results
CREATE TABLE result (
  id INT AUTO_INCREMENT PRIMARY KEY,
  analysis_id INT,
  status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (analysis_id) REFERENCES analysis(id) ON DELETE CASCADE
);

```

## Key Features

### 📊 Analysis Workflow
- Workflow templates stored as `.workflow` files
- Automatic script execution in sequence
- Support for Python and Node.js scripts
- Results exported as ZIP archives

### 🔐 Authentication & Security
- JWT-based authentication
- All API endpoints (except auth and health) require authentication
- CORS and security headers
- Input validation and SQL injection protection

## Development

```bash
# Start in development mode
npm run dev

# Run linting
npm run lint

# Run tests
npm test
```

## API Response Format

### Success Response
```json
{
  "items": [...],     // For list endpoints
  "id": 123,          // For single item endpoints
  "message": "..."    // For operation confirmations
}
```

### Error Response
```json
{
  "error": "Error description",
  "details": "Additional details if available"
}
```

## Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `404` - Not Found
- `500` - Internal Server Error

## License

MIT

## Author

Zbyšek Martoch - [GitHub](https://github.com/zbysekmartoch)
