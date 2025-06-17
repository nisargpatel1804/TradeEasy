import base64
import hashlib
import hmac
import os
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad, unpad
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AES_Encryption:
    DEFAULT_KEY_LENGTH = 32  # AES-256 bit key

    def __init__(self, salt=None, password_iterations=100000):
        """
        Initialize AES encryption with a salt and iterations.
        """
        # Use environment variable for salt, or generate one if not provided
        self.salt = (salt or os.getenv('ENCRYPTION_SALT', 'tradeeasy')).encode('utf-8')
        self.password_iterations = password_iterations

    def derive_key(self, salt):
        """
        Derive a 256-bit AES key from the salt using PBKDF2.
        """
        return PBKDF2(
            password=self.salt,
            salt=salt,
            dkLen=self.DEFAULT_KEY_LENGTH,  # 256-bit key
            count=self.password_iterations,
            prf=lambda p, s: hmac.new(p, s, hashlib.sha256).digest()
        )

    def aes_encrypt(self, plain_text):
        """
        Encrypts plain text using AES-256 encryption.
        """
        try:
            salt = get_random_bytes(16)  # Generate a random salt
            key = self.derive_key(salt)  # Derive the AES key
            iv = get_random_bytes(16)  # Generate IV
            cipher = AES.new(key, AES.MODE_CBC, iv)

            # Encrypt with padding
            cipher_text = cipher.encrypt(pad(plain_text.encode('utf-8'), AES.block_size))

            # Return base64-encoded salt + IV + cipher text
            encrypted_data = base64.b64encode(salt + iv + cipher_text).decode('utf-8')
            return encrypted_data

        except Exception as e:
            logger.error(f"Encryption error: {e}")
            return None

    def aes_decrypt(self, cipher_text):
        """
        Decrypts cipher text using AES-256 decryption.
        """
        try:
            cipher_data = base64.b64decode(cipher_text)
            salt = cipher_data[:16]  # Extract salt
            iv = cipher_data[16:32]  # Extract IV
            key = self.derive_key(salt)  # Derive the AES key

            cipher = AES.new(key, AES.MODE_CBC, iv)
            decrypted_text = unpad(cipher.decrypt(cipher_data[32:]), AES.block_size)

            return decrypted_text.decode('utf-8')

        except Exception as e:
            logger.error(f"Decryption error: {e}")
            return None


if __name__ == "__main__":
    # Test encryption and decryption
    aes_encryption = AES_Encryption()
    plain_text = "Hello, TradeEasy!"
    encrypted_text = aes_encryption.aes_encrypt(plain_text)
    print(f"Encrypted: {encrypted_text}")
    decrypted_text = aes_encryption.aes_decrypt(encrypted_text)
    print(f"Decrypted: {decrypted_text}")
