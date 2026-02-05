# Deployment Guide

## Overview

This guide covers deployment options for the Measure frontend application, from development to production environments.

## Build Process

### Development Build
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Access at http://localhost:5173
```

### Production Build
```bash
# Create optimized production build
npm run build

# Output directory: dist/
# Contains: index.html, assets/, static files
```

### Build Verification
```bash
# Preview production build locally
npm run preview

# Access at http://localhost:4173
```

## Environment Configuration

### Environment Files
```bash
# Development
.env.development
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_TITLE=Measure Development

# Production
.env.production
VITE_API_BASE_URL=https://api.measure-prod.example.com
VITE_APP_TITLE=Measure Production

# Local override (gitignored)
.env.local
VITE_API_BASE_URL=http://192.168.1.100:8000
```

### Runtime Configuration
```javascript
// Runtime environment detection
const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  appTitle: import.meta.env.VITE_APP_TITLE || 'Measure',
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD
};
```

## Static Hosting

### Nginx Deployment

**nginx.conf:**
```nginx
server {
    listen 80;
    server_name measure-frontend.example.com;
    root /var/www/measure-frontend;
    index index.html;

    # Handle client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API proxy (optional)
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

**Deployment Script:**
```bash
#!/bin/bash
# deploy.sh

# Build application
npm run build

# Copy to web server
scp -r dist/* user@server:/var/www/measure-frontend/

# Restart nginx
ssh user@server 'sudo systemctl reload nginx'

echo "Deployment complete!"
```

### Apache Deployment

**.htaccess:**
```apache
<IfModule mod_rewrite.c>
    RewriteEngine On
    
    # Handle client-side routing
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule . /index.html [L]
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/css "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
    ExpiresByType image/png "access plus 1 year"
</IfModule>
```

## Containerized Deployment

### Docker Setup

**Dockerfile:**
```dockerfile
# Multi-stage build
FROM node:18-alpine as build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built application
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  measure-frontend:
    build: .
    ports:
      - "80:80"
    environment:
      - VITE_API_BASE_URL=http://backend:8000
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    image: measure-backend:latest
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/measure
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=measure
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

### Kubernetes Deployment

**deployment.yaml:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: measure-frontend
  labels:
    app: measure-frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: measure-frontend
  template:
    metadata:
      labels:
        app: measure-frontend
    spec:
      containers:
      - name: measure-frontend
        image: measure-frontend:latest
        ports:
        - containerPort: 80
        env:
        - name: VITE_API_BASE_URL
          value: "https://api.measure.example.com"
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "128Mi"
            cpu: "100m"
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: measure-frontend-service
spec:
  selector:
    app: measure-frontend
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
  type: ClusterIP

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: measure-frontend-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: measure.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: measure-frontend-service
            port:
              number: 80
```

## CDN Deployment

### AWS CloudFront Setup

**S3 + CloudFront:**
```bash
# Upload to S3
aws s3 sync dist/ s3://measure-frontend-bucket/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

**CloudFormation Template:**
```yaml
Resources:
  S3Bucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: measure-frontend-bucket
      WebsiteConfiguration:
        IndexDocument: index.html
        ErrorDocument: index.html

  CloudFrontDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Origins:
        - DomainName: !GetAtt S3Bucket.DomainName
          Id: S3Origin
          S3OriginConfig:
            OriginAccessIdentity: !Sub "origin-access-identity/cloudfront/${OAI}"
        Enabled: true
        DefaultRootObject: index.html
        CustomErrorResponses:
        - ErrorCode: 404
          ResponseCode: 200
          ResponsePagePath: /index.html
        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: redirect-to-https
          Compress: true
        PriceClass: PriceClass_100
```

## CI/CD Pipeline

### GitHub Actions

**.github/workflows/deploy.yml:**
```yaml
name: Deploy Measure Frontend

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Run linting
      run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Build application
      run: npm run build
      env:
        VITE_API_BASE_URL: ${{ secrets.API_BASE_URL }}
    
    - name: Upload build artifacts
      uses: actions/upload-artifact@v3
      with:
        name: dist
        path: dist/

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - name: Download build artifacts
      uses: actions/download-artifact@v3
      with:
        name: dist
        path: dist/
    
    - name: Deploy to S3
      run: |
        aws s3 sync dist/ s3://${{ secrets.S3_BUCKET }}/ --delete
      env:
        AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
        AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    
    - name: Invalidate CloudFront
      run: |
        aws cloudfront create-invalidation \
          --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
          --paths "/*"
```

### GitLab CI

**.gitlab-ci.yml:**
```yaml
stages:
  - test
  - build
  - deploy

variables:
  NODE_VERSION: "18"

cache:
  paths:
    - node_modules/

test:
  stage: test
  image: node:$NODE_VERSION
  script:
    - npm ci
    - npm run test
    - npm run lint

build:
  stage: build
  image: node:$NODE_VERSION
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 hour
  only:
    - main

deploy_staging:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache rsync openssh
  script:
    - rsync -avz --delete dist/ $STAGING_SERVER:/var/www/measure-staging/
  environment:
    name: staging
    url: https://measure-staging.example.com
  only:
    - main

deploy_production:
  stage: deploy
  image: alpine:latest
  before_script:
    - apk add --no-cache rsync openssh
  script:
    - rsync -avz --delete dist/ $PRODUCTION_SERVER:/var/www/measure-frontend/
  environment:
    name: production
    url: https://measure.example.com
  when: manual
  only:
    - main
```

## Security Configuration

### Content Security Policy

**index.html:**
```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
">
```

### HTTPS Configuration

**nginx SSL:**
```nginx
server {
    listen 443 ssl http2;
    server_name measure.example.com;

    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Application configuration
    root /var/www/measure-frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Redirect HTTP to HTTPS
server {
  listen 80;
  server_name measure.example.com;
    return 301 https://$server_name$request_uri;
}
```

## Monitoring and Health Checks

### Health Check Endpoint

**health.html:**
```html
<!DOCTYPE html>
<html>
<head>
    <title>Health Check</title>
</head>
<body>
    <h1>Measure Frontend - OK</h1>
    <p>Version: 1.0.0</p>
    <p>Build: 2025-10-05</p>
    <script>
        // Check if app can load
        fetch('/').then(() => {
            document.body.style.backgroundColor = 'lightgreen';
        }).catch(() => {
            document.body.style.backgroundColor = 'lightcoral';
        });
    </script>
</body>
</html>
```

### Monitoring Setup

**Prometheus + Grafana:**
```yaml
# docker-compose.monitoring.yml
version: '3.8'

services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-storage:/var/lib/grafana

  nginx-exporter:
    image: nginx/nginx-prometheus-exporter
    command:
      - '-nginx.scrape-uri=http://measure-frontend:80/nginx_status'
    ports:
      - "9113:9113"

volumes:
  grafana-storage:
```

## Troubleshooting

### Common Deployment Issues

**Build Failures:**
- Check Node.js version compatibility
- Verify environment variables
- Clear npm cache: `npm cache clean --force`

**Routing Issues:**
- Ensure server redirects 404s to index.html
- Check base URL configuration
- Verify client-side routing setup

**API Connection Problems:**
- Verify VITE_API_BASE_URL setting
- Check CORS configuration on backend
- Test API endpoints directly

**Performance Issues:**
- Enable gzip compression
- Implement proper caching headers
- Use CDN for static assets
- Optimize bundle size with code splitting

### Rollback Procedures

**Quick Rollback:**
```bash
# Save current deployment
cp -r /var/www/measure-frontend /var/www/measure-frontend.backup

# Restore previous version
cp -r /var/www/measure-frontend.previous /var/www/measure-frontend

# Restart web server
sudo systemctl reload nginx
```

**Database Rollback:**
```bash
# If backend API changes require database changes
# Coordinate with backend team for rollback procedures
```