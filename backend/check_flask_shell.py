# -*- coding: utf-8 -*-

from app import db
from app.models import User, Watchlist

# Check database connection
try:
    db.session.execute(db.text('SELECT 1'))
    print("✅ Database connection successful!")
except Exception as e:
    print(f"❌ Database connection failed: {e}")

# 1️⃣ Check all users
print("\n📋 **List of all users:**")
users = User.query.all()
if users:
    for user in users:
        print(f"ID: {user.id}, Username: {user.username}, Email: {user.email}")
else:
    print("⚠️ No users found!")

# 2️⃣ Check specific user
username_to_check = "use123.com"  # 🔄 Change this to the desired username
user = User.query.filter_by(username=username_to_check).first()

if user:
    print(f"\n✅ User found: {user.username} (ID: {user.id})")
else:
    print(f"❌ User '{username_to_check}' not found!")

# 3️⃣ Check Watchlist for the user
if user:
    print("\n🕵️‍♂️ **Watchlist for user:**")
    try:
        watchlist = Watchlist.query.filter_by(user_id=user.id).all()
        if watchlist:
            for item in watchlist:
                print(f"- ID: {item.id}, Symbol: {item.symbol}, Added at: {item.added_at}")
        else:
            print("⚠️ No watchlist items found for this user!")
    except Exception as e:
        print(f"❌ Failed to fetch watchlist: {e}")

# 4️⃣ Optional: Raw SQL check
print("\n🗄️ **Raw SQL user check:**")
try:
    result = db.session.execute(db.text("SELECT id, username, email FROM users")).fetchall()
    for row in result:
        print(f"ID: {row.id}, Username: {row.username}, Email: {row.email}")
except Exception as e:
    print(f"❌ Failed to run raw query: {e}")

# 5️⃣ Close session
db.session.close()
print("\n✅ Flask shell check complete!")
