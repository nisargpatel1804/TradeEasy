# Security Best Practices for TradeEasy

## Credential Encryption and Secure Storage

### ⚠️ Current State
Currently, the application stores sensitive API credentials in plain text `.env` files. This is **NOT suitable for production** use.

### 🔒 Recommended Solutions

#### Option 1: Environment Variable Encryption (Development/Small Teams)

Use the `cryptography` library to encrypt sensitive credentials:

```bash
pip install cryptography
```

**Step 1: Generate an encryption key**
```python
# scripts/generate_key.py
from cryptography.fernet import Fernet

# Generate key (run once, store securely!)
key = Fernet.generate_key()
print(f"Encryption key: {key.decode()}")
print("\n⚠️ IMPORTANT: Store this key in a secure location!")
print("Set it as ENCRYPTION_KEY environment variable")
```

**Step 2: Encrypt your credentials**
```python
# scripts/encrypt_credentials.py
import os
from cryptography.fernet import Fernet

def encrypt_value(value, key):
    f = Fernet(key.encode())
    return f.encrypt(value.encode()).decode()

# Load encryption key from environment
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY')
if not ENCRYPTION_KEY:
    raise ValueError("ENCRYPTION_KEY must be set!")

# Encrypt credentials
api_key = "your-api-key-here"
encrypted = encrypt_value(api_key, ENCRYPTION_KEY)
print(f"Encrypted API_KEY: {encrypted}")
```

**Step 3: Decrypt in your application**
```python
# backend/app/utils/encryption.py
import os
from cryptography.fernet import Fernet

def decrypt_credential(encrypted_value):
    """Decrypt an encrypted credential."""
    encryption_key = os.getenv('ENCRYPTION_KEY')
    if not encryption_key:
        raise ValueError("ENCRYPTION_KEY not set")
    
    f = Fernet(encryption_key.encode())
    return f.decrypt(encrypted_value.encode()).decode()

# Usage in config.py:
# from app.utils.encryption import decrypt_credential
# API_KEY = decrypt_credential(os.getenv("API_KEY_ENCRYPTED"))
```

#### Option 2: Cloud Secrets Manager (Production)

**Azure Key Vault**
```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

credential = DefaultAzureCredential()
client = SecretClient(
    vault_url="https://your-vault.vault.azure.net/",
    credential=credential
)

API_KEY = client.get_secret("mo-api-key").value
```

**AWS Secrets Manager**
```python
import boto3
import json

client = boto3.client('secretsmanager', region_name='us-east-1')
response = client.get_secret_value(SecretId='tradeeasy/mo-credentials')
credentials = json.loads(response['SecretString'])

API_KEY = credentials['api_key']
```

**HashiCorp Vault**
```python
import hvac

client = hvac.Client(url='http://127.0.0.1:8200')
client.token = os.getenv('VAULT_TOKEN')

secret = client.secrets.kv.v2.read_secret_version(
    path='tradeeasy/mo-credentials'
)
API_KEY = secret['data']['data']['api_key']
```

#### Option 3: Docker Secrets (Container Deployments)

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    image: tradeeasy-backend
    secrets:
      - mo_api_key
      - mo_totp_secret
    environment:
      API_KEY_FILE: /run/secrets/mo_api_key
      TOTP_SECRET_FILE: /run/secrets/mo_totp_secret

secrets:
  mo_api_key:
    file: ./secrets/api_key.txt
  mo_totp_secret:
    file: ./secrets/totp_secret.txt
```

```python
# Read from Docker secrets
def read_secret(secret_name):
    secret_path = f'/run/secrets/{secret_name}'
    try:
        with open(secret_path, 'r') as f:
            return f.read().strip()
    except FileNotFoundError:
        return os.getenv(secret_name.upper())

API_KEY = read_secret('mo_api_key')
```

### 🛡️ Additional Security Measures

1. **Never commit `.env` files to version control**
   - Already in `.gitignore`
   - Use `.env.example` with dummy values

2. **Rotate credentials regularly**
   - Change API keys every 90 days
   - Update TOTP secrets if compromised

3. **Use environment-specific credentials**
   - Separate credentials for dev, staging, prod
   - Never use production credentials in development

4. **Audit access logs**
   - Monitor who accesses secrets
   - Set up alerts for unauthorized access

5. **Principle of least privilege**
   - Only grant access to credentials that are needed
   - Use service accounts with limited permissions

### 📋 Implementation Checklist

- [ ] Choose a secrets management solution
- [ ] Generate encryption keys or set up cloud vault
- [ ] Encrypt existing credentials
- [ ] Update application code to decrypt/fetch secrets
- [ ] Test in development environment
- [ ] Document the process for team members
- [ ] Set up credential rotation policy
- [ ] Configure monitoring and alerts
- [ ] Remove plain-text credentials from all environments
- [ ] Update deployment pipelines

### 🚨 Emergency Response

If credentials are compromised:

1. **Immediately revoke** the compromised credentials
2. **Generate new** API keys and secrets
3. **Update** all environments with new credentials
4. **Audit** recent access logs for suspicious activity
5. **Review** security practices to prevent future incidents

---

**Note**: The encryption key or vault access credentials should be stored separately from the application code and should be managed by your infrastructure/ops team.
