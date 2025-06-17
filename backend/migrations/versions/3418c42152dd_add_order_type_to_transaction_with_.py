"""Add order_type to Transaction with default

Revision ID: 3418c42152dd
Revises: 62d331f5cdd7
Create Date: 2025-06-13 14:26:21.271909

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3418c42152dd'
down_revision = '62d331f5cdd7'
branch_labels = None
depends_on = None


def upgrade():
    # Add the column with a server default to satisfy SQL Server constraints
    with op.batch_alter_table('transactions', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('order_type', sa.String(length=10), nullable=False, server_default='market')
        )

    # Optional: If you want to remove the default after the column has been added
    # (uncomment if needed — depends on your design decision)
    # op.alter_column('transactions', 'order_type', server_default=None)


def downgrade():
    with op.batch_alter_table('transactions', schema=None) as batch_op:
        batch_op.drop_column('order_type')
