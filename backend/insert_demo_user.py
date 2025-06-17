import pyodbc
from app.utils.aes_encryption import AES_Encryption
import os

# ✅ Load environment variables
DB_SERVER = os.getenv("DB_SERVER", "localhost")
DB_NAME = os.getenv("DB_NAME", "TradeEasyDB")
DB_USERNAME = os.getenv("DB_USERNAME", "sa")
DB_PASSWORD = os.getenv("DB_PASSWORD", "Nisarg@18")

# ✅ Initialize AES encryption
aes = AES_Encryption()

# ✅ Encrypt the password before storing it
plain_password = "SecureDemo123"
encrypted_password = aes.aes_encrypt(plain_password)

# ✅ Check if encryption failed
if not encrypted_password:
    print("❌ Encryption failed. Exiting...")
    exit(1)

# ✅ Database connection (Use environment variables)
conn_str = (
    f"DRIVER={{ODBC Driver 17 for SQL Server}};"
    f"SERVER={DB_SERVER};"
    f"DATABASE={DB_NAME};"
    f"UID={DB_USERNAME};"
    f"PWD={DB_PASSWORD};"
    f"Encrypt=no;TrustServerCertificate=yes;"
)

# ✅ Initialize variables to avoid reference issues in `finally`
conn = None
cursor = None

try:
    # ✅ Connect to SQL Server
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()

    # ✅ SQL Insert Query (With Encrypted Password)
    query = """
    INSERT INTO users (client_id, username, password, email, mobile, balance, created_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, GETUTCDATE(), ?);
    """

    # ✅ Execute the query
    cursor.execute(
        query,
        ('ABC1234', 'demo_user', encrypted_password, 'demo@example.com', '+911234567890', 1000000.00, 1)
    )
    conn.commit()

    print("✅ Demo user inserted successfully!")

except Exception as e:
    print(f"❌ Error inserting demo user: {e}")

finally:
    # ✅ Close connection safely
    if cursor:
        cursor.close()
    if conn:
        conn.close()
