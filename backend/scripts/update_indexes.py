#!/usr/bin/env python3
"""
Database Index Migration Script for TradeEasy

This script ensures all database indexes are created/updated according to the new schema.
Run this after pulling the latest code changes.

Usage:
    python scripts/update_indexes.py
"""

import sys
import os

# Add parent directory to path to import app modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import create_app
from app.models import User, Stock, Transaction, Holding, AQScrip

def update_indexes():
    """Update all database indexes."""
    print("📊 Updating database indexes...")
    
    app = create_app()
    
    with app.app_context():
        models = [
            ('User', User),
            ('Stock', Stock),
            ('Transaction', Transaction),
            ('Holding', Holding),
            ('AQScrip', AQScrip),
        ]
        
        for model_name, model_class in models:
            try:
                print(f"\n🔧 Updating indexes for {model_name}...")
                model_class.ensure_indexes()
                print(f"✅ {model_name} indexes updated successfully")
            except Exception as e:
                print(f"❌ Error updating {model_name} indexes: {e}")
                continue
        
        print("\n✅ All indexes updated successfully!")
        print("\nCurrent indexes:")
        
        # Display current indexes for each collection
        from mongoengine import connection
        db = connection.get_db()
        
        for model_name, model_class in models:
            collection_name = model_class._get_collection_name()
            if collection_name in db.list_collection_names():
                indexes = db[collection_name].index_information()
                print(f"\n{model_name} ({collection_name}):")
                for idx_name, idx_info in indexes.items():
                    print(f"  - {idx_name}: {idx_info.get('key', [])}")

if __name__ == '__main__':
    update_indexes()
